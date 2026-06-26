const $ = (id) => document.getElementById(id);
const gbp = (pence) => "£" + (pence / 100).toFixed(2);
const hhmm = (iso) => (iso ? new Date(iso).toISOString().slice(11, 16) : "—");
const date = (iso) => new Date(iso).toISOString().slice(0, 10);
const poundsToPence = (v) => Math.round(parseFloat(v) * 100); // "12.40" -> 1240, dodging float drift
// Build a { type: pence } table from a set of fare inputs (each tagged data-fare-type). Blank = omit.
const faresFrom = (els) => {
  const fares = {};
  els.forEach((i) => { if (i.value !== "") fares[i.dataset.fareType] = poundsToPence(i.value); });
  return fares;
};
const collectFares = (routeId) => faresFrom(document.querySelectorAll(`[data-route-fare="${routeId}"]`));

let STATE = { config: {}, tickets: [], metrics: {} };

// Status badge styling. Emerald is reserved for money owed, per the PRD.
const BADGE = {
  "on-time": ["On Time", "bg-slate-100 text-slate-600"],
  eligible: ["Eligible: 15+ min", "bg-emerald-100 text-claim"],
  "awaiting-confirmation": ["Which train?", "bg-amber-100 text-warn"],
  "awaiting-arrival": ["Pending Arrival", "bg-amber-100 text-warn"],
  claimed: ["Claim filed", "bg-blue-100 text-accent"],
  rejected: ["Rejected", "bg-red-100 text-red-600"],
  "action-required": ["Action Required", "bg-amber-100 text-warn"],
};

const TICKET_TYPES = [["single", "Single"], ["return", "Return"], ["travelcard", "Travelcard"], ["multi", "Multi"], ["season", "Season"]];
// Per-type fares are entered as the per-journey amount the refund is banded off. Season/travelcard/multi
// take your daily- or trip-equivalent cost (a return is the whole-ticket fare; assessDelay halves it).
const FARE_TYPES = TICKET_TYPES;
// Band shown as a plain % in the status chip (statusCell), so the refund column stays a bare £.
const BAND_PCT = { "25%": "25%", "50%": "50%", "100%": "100%", "100%-return": "full return" };

// Status chip. For eligible delays, fold the delay length and refund band into the chip — the row
// then reads its own "why" without the refund column having to carry a % string.
function statusCell(t) {
  const [label, cls] = BADGE[t.status] ?? ["—", "bg-slate-100"];
  const text = t.status === "eligible" && t.assessment
    ? `Eligible · ${t.assessment.delayMinutes} min · ${BAND_PCT[t.assessment.band] ?? t.assessment.band}`
    : label;
  return `<span class="px-2 py-1 rounded text-xs font-medium ${cls}">${text}</span>`;
}
function showToast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add("hidden"), 1800);
}

async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({ error: res.statusText }));
  // Fail loudly: a 404 (e.g. an outdated daemon missing a new route) used to return an error object
  // that silently broke render/autofill. Surface it instead of doing nothing.
  if (!res.ok) {
    alert(`Request to ${path} failed (${res.status}). If you just updated the app, restart the daemon.`);
    throw new Error(data.error || res.status);
  }
  return data;
}

function metricCard(label, value) {
  return `<div class="bg-white rounded-lg border border-slate-200 p-4">
    <div class="text-sm text-slate-500">${label}</div>
    <div class="text-2xl font-semibold mt-1">${value}</div></div>`;
}

// Refund is a pure £ amount now — the band/% it was worked out from lives in the status chip
// (statusCell). £0.00 when no fare is on file; the chip still shows the band so they know the %.
function refundCell(t) {
  return t.assessment ? gbp(t.assessment.refundPence) : "—";
}

// Operator is read-only — it's a fact from the live arrival data, not the user's to set. The ticket
// type is a per-journey override of "your usual ticket"; we only flag it when it actually differs,
// so an unchanged row stays quiet and the column carries no extra noise.
function operatorCell(t) {
  const op = `<span class="font-mono">${t.toc || t.journey.retailer}</span>`;
  if (!t.fromRoute) return op;
  const usual = STATE.config.defaultTicketType ?? "single";
  const overridden = t.journey.ticketType !== usual;
  const opts = TICKET_TYPES.map(([v, l]) => `<option value="${v}" ${v === t.journey.ticketType ? "selected" : ""}>${l}</option>`).join("");
  return `<div class="flex flex-col gap-0.5">${op}
    <select data-tickettype="${t.id}" title="Ticket type for just this journey — overrides your usual ticket." class="border rounded px-1 py-0.5 text-xs ${overridden ? "border-accent text-accent" : "text-slate-500"}">${opts}</select>
    ${overridden ? '<span class="text-[10px] text-accent leading-none">one-off · not your usual</span>' : ""}</div>`;
}

function row(t) {
  const refund = refundCell(t);
  const delay = t.assessment ? `${t.assessment.delayMinutes} min` : "—";
  // Claim only when the operator has a verified portal — otherwise show why it's withheld rather
  // than a dead "Claim now". Confirmation prompts are independent of the portal.
  const claimable = t.status === "eligible" || t.status === "action-required";
  const action = claimable
    ? t.portalUrl
      ? `<button data-claim="${t.id}" class="text-accent font-medium">${t.status === "action-required" ? "File manually" : "Claim now"}</button>`
      : `<span class="text-slate-400 text-xs" title="No verified Delay Repay portal for ${t.toc || "this operator"} yet">Portal not supported</span>`
    : t.status === "awaiting-confirmation"
      ? `<button data-confirm="${t.id}" class="text-warn font-medium">I took this train</button>`
      : "";
  return `<tr class="border-t border-slate-100">
    <td class="px-4 py-2 font-mono">${date(t.journey.scheduledDeparture)}</td>
    <td class="px-4 py-2">${t.journey.origin} → ${t.journey.destination}${t.cancelledConnection ? `<div class="text-xs text-warn">⚠ booked service cancelled — counted as a delay</div>` : ""}</td>
    <td class="px-4 py-2">${operatorCell(t)}</td>
    <td class="px-4 py-2 font-mono">${hhmm(t.journey.scheduledArrival)}</td>
    <td class="px-4 py-2 font-mono">${hhmm(t.actualArrival)}</td>
    <td class="px-4 py-2 font-mono">${delay}</td>
    <td class="px-4 py-2 font-mono ${t.status === "eligible" ? "text-claim font-semibold" : ""}">${refund}</td>
    <td class="px-4 py-2">${statusCell(t)}</td>
    <td class="px-4 py-2 text-right whitespace-nowrap">${action}
      <button data-del="${t.id}" title="Stop tracking this journey" class="text-slate-400 hover:text-red-500 ml-3">Remove</button></td></tr>`;
}

// Friendly day heading like "Thursday 25 June 2026" (UTC, matching the stored ISO times).
const dayLabel = (iso) => new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const dayHeader = (iso) => `<tr><td colspan="9" class="px-4 pt-5 pb-1 font-semibold text-slate-700 bg-slate-50 border-t-2 border-slate-200">${dayLabel(iso)}</td></tr>`;
// Outbound = blue (accent), Return = amber (warn), so direction reads at a glance.
const dirHeader = (label, t) => `<tr><td colspan="9" class="px-4 py-1 text-xs uppercase tracking-wide text-slate-400"><span class="font-medium ${label === "Return" ? "text-warn" : "text-accent"}">${label}</span> · ${t.journey.origin} → ${t.journey.destination}</td></tr>`;

// Group rows by day, then within a day by direction, so a round trip reads outbound-then-return and
// it's obvious which direction on which day. Direction order follows earliest departure (the morning
// leg is outbound) — no home/away model needed. ponytail: a 3rd direction in a day just reads
// "Return" too; rare and harmless.
function ticketRows(tickets) {
  if (!tickets.length) return "";
  const sorted = [...tickets].sort((a, b) => a.journey.scheduledDeparture.localeCompare(b.journey.scheduledDeparture));
  const byKey = (list, key) => {
    const m = new Map();
    for (const t of list) (m.get(key(t)) ?? m.set(key(t), []).get(key(t))).push(t);
    return m;
  };
  let html = "";
  for (const dayTickets of byKey(sorted, (t) => date(t.journey.scheduledDeparture)).values()) {
    html += dayHeader(dayTickets[0].journey.scheduledDeparture);
    const dirs = byKey(dayTickets, (t) => `${t.journey.origin}→${t.journey.destination}`);
    let i = 0;
    for (const dirTickets of dirs.values()) {
      // First direction of the day is the Outbound; any later one is the Return. Labelled on every
      // journey now, not just round-trip days — a lone single still reads "Outbound".
      html += dirHeader(i === 0 ? "Outbound" : "Return", dirTickets[0]);
      html += dirTickets.map(row).join("");
      i++;
    }
  }
  return html;
}

// Setup isn't done until there's a train-data token and at least one watched route. Demo mode
// skips the wizard entirely (it ships its own sample route + scripted data).
function needsSetup(c) {
  return !c.demo && (!c.hasRtt || !(c.routes && c.routes.length));
}

function render(state) {
  STATE = state;
  const c = state.config;

  if (needsSetup(c)) return showWizard(c);
  $("wizard").classList.add("hidden");
  $("wizard").dataset.ready = ""; // allow a fresh redraw if setup is ever re-entered
  $("dashboard").classList.remove("hidden");
  $("dash-actions").classList.remove("hidden");

  $("default-type").value = c.defaultTicketType ?? "single";
  $("mode").textContent = c.demo ? "Demo mode — sample data" : "Live";
  const m = state.metrics;
  $("metrics").innerHTML =
    metricCard("Total Reclaimed", gbp(m.totalReclaimedPence)) +
    metricCard("Pending Eligible Claims", `${m.pendingEligibleCount} · ${gbp(m.pendingEligiblePence)}`) +
    metricCard("Refunds Requested This Month", m.refundsRequested);
  renderEarnCta(c, m);
  $("tickets").innerHTML = ticketRows(state.tickets) || `<tr><td colspan="9" class="px-4 py-8 text-center text-slate-400">No claims yet — your trains have been suspiciously punctual. Add a watched route in Settings and we'll keep an eye on them.</td></tr>`;
  $("settings").innerHTML = settingsForm(c);
}

// Homepage nudge: when there are claimable delays but no prices on file, the £ estimate is £0 — so
// invite the user to add ticket prices to see what they could earn back. Hidden once prices produce a £.
function renderEarnCta(c, m) {
  const el = $("earn-cta");
  const needsPrices = m.pendingEligibleCount > 0 && m.pendingEligiblePence === 0 && c.routes && c.routes.length;
  el.classList.toggle("hidden", !needsPrices);
  if (!needsPrices) return;
  el.innerHTML = `<div class="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-center justify-between gap-4">
    <p class="text-sm text-emerald-900">You have <b>${m.pendingEligibleCount}</b> eligible delay${m.pendingEligibleCount > 1 ? "s" : ""} but no ticket prices yet — add what you pay to see how much you could claim back.</p>
    <button id="cta-prices" class="bg-claim text-white px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap">Add ticket prices</button></div>`;
}

// One £ input per ticket type, pre-filled from the route's saved fares. data-route-fare carries the
// route id so the change handler can re-gather every type for that route into one save.
function fareInputs(r) {
  return FARE_TYPES.map(
    ([v, l]) => `<label class="flex flex-col text-[11px] text-slate-500 leading-tight">${l}
      <span>£<input data-route-fare="${r.id}" data-fare-type="${v}" type="number" step="0.01" min="0" value="${r.fares && r.fares[v] != null ? (r.fares[v] / 100).toFixed(2) : ""}" placeholder="0.00" class="border rounded px-1 py-0.5 w-16 text-right font-mono" /></span></label>`,
  ).join("");
}

function routeList(routes) {
  if (!routes || !routes.length) return `<p class="text-sm text-slate-400">No watched routes yet.</p>`;
  // Mirror = same days, reversed origin↔destination (the return leg of a round trip). Collapse into
  // one settings row so the user only enters prices once; the backend syncs fares to the return leg.
  const sameDaysStr = (a, b) => JSON.stringify([...(a.days ?? [])].sort()) === JSON.stringify([...(b.days ?? [])].sort());
  const findMirror = (r) => routes.find((m) => m.id !== r.id && m.origin === r.destination && m.destination === r.origin && sameDaysStr(r, m));
  const shown = new Set();
  return routes.map((r) => {
    if (shown.has(r.id)) return "";
    const mirror = findMirror(r);
    if (mirror) shown.add(mirror.id);
    const routeDesc = mirror
      ? `<b>${r.origin} → ${r.destination}</b> <span class="font-mono text-slate-500">${r.fromTime}–${r.toTime}</span> <span class="text-slate-400">↕ return</span> <span class="font-mono text-slate-500">${mirror.fromTime}–${mirror.toTime}</span>`
      : `<b>${r.origin} → ${r.destination}</b> <span class="font-mono text-slate-500">${r.fromTime}–${r.toTime}</span>`;
    const delBtn = mirror
      ? `<button data-route-del="${r.id}" data-route-del-mirror="${mirror.id}" class="text-red-500">Remove</button>`
      : `<button data-route-del="${r.id}" class="text-red-500">Remove</button>`;
    return `<div class="bg-slate-50 rounded px-3 py-2 text-sm space-y-2">
        <div class="flex items-center justify-between">
          <span>${r.label}: ${routeDesc}${r.confirm ? ' <span class="text-warn text-xs">· asks which train</span>' : ""}</span>
          ${delBtn}
        </div>
        <div class="flex flex-wrap gap-2 items-end" title="Ticket prices for this journey — used to estimate your refund. Fill in the types you might buy.">${fareInputs(r)}</div></div>`;
  }).join("");
}

function settingsForm(c) {
  return `<form id="config-form" class="grid grid-cols-2 gap-3 text-sm">
    <label class="col-span-2 flex items-center gap-2 text-sm"><input name="demoMode" type="checkbox" ${c.demo ? "checked" : ""} /> Demo mode — show sample data instead of tracking real journeys</label>

    <div class="col-span-2 border-t pt-2 mt-1 text-slate-500 text-xs uppercase tracking-wide">Watched routes</div>
    <p class="col-span-2 text-xs text-slate-500">Add a regular journey and a time window. We'll watch every train in that window and alert you when one is delayed 15+ minutes.</p>
    <div id="route-list" class="col-span-2 space-y-1">${routeList(c.routes)}</div>
    <input name="rLabel" class="border rounded px-2 py-1" placeholder="Label (e.g. Morning commute)" />
    <div class="grid grid-cols-2 gap-2">
      <input name="rFrom" class="border rounded px-2 py-1 font-mono" placeholder="From 06:30" />
      <input name="rTo" class="border rounded px-2 py-1 font-mono" placeholder="To 10:00" />
    </div>
    <input name="rOrigin" list="stations" class="border rounded px-2 py-1" placeholder="From station (e.g. London Waterloo)" />
    <input name="rDest" list="stations" class="border rounded px-2 py-1" placeholder="To station (e.g. Brighton)" />
    <label class="col-span-2 flex items-center gap-2 text-xs text-slate-600"><input name="rConfirm" type="checkbox" /> Season ticket / flexible: if several trains are delayed, ask me which one I took (optional)</label>
    <button type="button" id="route-add" class="col-span-2 border border-claim text-claim px-4 py-2 rounded-md w-fit">Add watched route</button>

    <div class="col-span-2 border-t pt-2 mt-1 text-slate-500 text-xs uppercase tracking-wide">Train data (Realtime Trains)</div>
    <p class="col-span-2 text-xs text-slate-500">Get a free token at <span class="font-mono">api-portal.rtt.io</span> (personal use). Paste it below to fetch live arrivals.</p>
    <div class="col-span-2 text-sm font-medium ${c.hasRtt ? "text-claim" : "text-slate-400"}">${c.hasRtt ? "✓ RTT token saved" : "○ No RTT token yet"}</div>
    <label class="flex flex-col col-span-2">RTT token (Next Gen)<input name="rttToken" type="password" class="border rounded px-2 py-1" placeholder="${c.hasRtt ? "•••••• saved (paste again to replace)" : "paste token here"}" /></label>
    <label class="flex flex-col col-span-2 text-xs text-slate-400">Legacy api.rtt.io username (only if using the old API — leave blank)<input name="rttUser" class="border rounded px-2 py-1" /></label>

    <label class="flex flex-col col-span-2">Backfill past days (7–28)<input name="scanDays" type="number" min="7" max="28" value="${c.scanDays}" class="border rounded px-2 py-1 w-32" /></label>
    <button class="col-span-2 bg-accent text-white px-4 py-2 rounded-md w-fit">Save settings</button>
  </form>`;
}

// Mon-first day picker; values are JS getUTCDay numbers (0=Sun..6=Sat). Mon–Fri checked by default.
const DAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"]];

function wizardHtml() {
  return `
  <h2 class="text-lg font-semibold mb-1">Set up Delay Repay Sweeper</h2>
  <p class="text-sm text-slate-500 mb-5">Four quick steps (the last is optional), then we'll track your trains and check the last 28 days.</p>

  <div data-step="1" class="space-y-3">
    <h3 class="font-medium">Step 1 of 4 · Connect train data</h3>
    <ol class="text-sm text-slate-600 list-decimal pl-5 space-y-1">
      <li>Open <span class="font-mono">api-portal.rtt.io</span> and sign up — free, for personal use.</li>
      <li>Create an app token under your account.</li>
      <li>Paste it below.</li>
    </ol>
    <input id="wiz-token" type="password" class="border rounded px-2 py-1 w-full" placeholder="RTT app token" />
    <div class="flex justify-end"><button data-wiz-next="1" class="bg-accent text-white px-4 py-2 rounded-md text-sm">Save & continue</button></div>
  </div>

  <div data-step="2" class="space-y-3 hidden">
    <h3 class="font-medium">Step 2 of 4 · Your journey & times</h3>
    <div class="grid grid-cols-2 gap-3 text-sm">
      <label class="flex flex-col">Home station<input id="wiz-home" list="stations" class="border rounded px-2 py-1" placeholder="London Waterloo" /></label>
      <label class="flex flex-col">Destination station<input id="wiz-dest" list="stations" class="border rounded px-2 py-1" placeholder="Brighton" /></label>
      <label class="flex flex-col">Departure window — from<input id="wiz-out-from" type="time" class="border rounded px-2 py-1" value="06:30" /></label>
      <label class="flex flex-col">Departure window — to<input id="wiz-out-to" type="time" class="border rounded px-2 py-1" value="10:00" /></label>
      <label class="flex flex-col">Return window — from<input id="wiz-ret-from" type="time" class="border rounded px-2 py-1" value="16:00" /></label>
      <label class="flex flex-col">Return window — to<input id="wiz-ret-to" type="time" class="border rounded px-2 py-1" value="19:30" /></label>
    </div>
    <div class="flex justify-between"><button data-wiz-back="1" class="text-slate-500 text-sm">← Back</button><button data-wiz-next="2" class="bg-accent text-white px-4 py-2 rounded-md text-sm">Continue</button></div>
  </div>

  <div data-step="3" class="space-y-3 hidden">
    <h3 class="font-medium">Step 3 of 4 · Which days do you travel?</h3>
    <div class="flex flex-wrap gap-2 text-sm">
      ${DAYS.map(([n, l]) => `<label class="flex items-center gap-1 border rounded px-3 py-1"><input type="checkbox" class="wiz-day" value="${n}" ${n >= 1 && n <= 5 ? "checked" : ""}/> ${l}</label>`).join("")}
    </div>
    <div class="flex justify-between"><button data-wiz-back="2" class="text-slate-500 text-sm">← Back</button><button data-wiz-next="3" class="bg-accent text-white px-4 py-2 rounded-md text-sm">Continue</button></div>
  </div>

  <div data-step="4" class="space-y-3 hidden">
    <h3 class="font-medium">Step 4 of 4 · Ticket prices <span class="text-slate-400 font-normal">(optional)</span></h3>
    <p class="text-sm text-slate-500">Add what you pay for this journey and we'll estimate how much you could claim back. Fill in only the types you buy — leave the rest blank. You can change these any time in Settings.</p>
    <div class="flex flex-wrap gap-3 items-end">
      ${FARE_TYPES.map(([v, l]) => `<label class="flex flex-col text-xs text-slate-600">${l}<span>£<input data-fare-type="${v}" type="number" step="0.01" min="0" placeholder="0.00" class="wiz-fare border rounded px-1 py-0.5 w-20 text-right font-mono" /></span></label>`).join("")}
    </div>
    <div class="flex justify-between"><button data-wiz-back="3" class="text-slate-500 text-sm">← Back</button>
      <span class="flex gap-3"><button id="wiz-skip" class="text-slate-500 text-sm">Skip for now</button><button id="wiz-finish" class="bg-claim text-white px-4 py-2 rounded-md text-sm">Finish & start tracking</button></span></div>
  </div>

  <p class="text-xs text-slate-400 mt-5 border-t pt-3">Just want to look around? <button id="wiz-demo" class="text-accent underline">Try demo mode</button> — sample data, no account needed.</p>`;
}

// Draw the wizard once and hold it; render() runs on every API response and must not wipe the
// half-filled form. dataset.ready is the latch — cleared again when we leave for the dashboard.
function showWizard(c) {
  $("dashboard").classList.add("hidden");
  $("dash-actions").classList.add("hidden");
  const w = $("wizard");
  if (!w.dataset.ready) {
    w.innerHTML = wizardHtml();
    w.dataset.ready = "1";
    wizStep(c.hasRtt ? 2 : 1); // resume at the journey step if a token was already saved
  }
  w.classList.remove("hidden");
}

function wizStep(n) {
  document.querySelectorAll("#wizard [data-step]").forEach((el) => el.classList.toggle("hidden", Number(el.dataset.step) !== n));
}

// Outbound + return become two watched routes sharing the same travel days and fares (same journey,
// same price both ways). Then backfill the last 28 days and drop into the dashboard.
async function finishWizard(fares) {
  const home = $("wiz-home").value, dest = $("wiz-dest").value;
  const days = [...document.querySelectorAll(".wiz-day:checked")].map((el) => Number(el.value));
  await api("/api/routes", { label: `${home} → ${dest}`, origin: home, destination: dest, fromTime: $("wiz-out-from").value, toTime: $("wiz-out-to").value, days, fares });
  await api("/api/routes", { label: `${dest} → ${home}`, origin: dest, destination: home, fromTime: $("wiz-ret-from").value, toTime: $("wiz-ret-to").value, days, fares });
  render(await api("/api/backfill", {}));
}

// No TOC exposes a claim API, so "Claim now" just opens the operator's own portal (done by the
// caller) and asks whether the user filed it. Yes → markFiled flips the row to "Claim filed".
function confirmFiled(ticketId) {
  const t = STATE.tickets.find((x) => x.id === ticketId);
  $("modal").innerHTML = `<div class="bg-white rounded-lg w-full max-w-md p-5">
    <h2 class="font-semibold mb-2">Did you file your claim?</h2>
    <p class="text-sm text-slate-500 mb-4">We've opened ${t?.toc || "the operator"}'s Delay Repay portal in a new tab. Fill in the form there, then come back and let us know.</p>
    <div class="flex gap-2 justify-end">
      <button id="close-modal" class="border px-4 py-2 rounded-md text-sm">Not yet</button>
      <button data-filed="${ticketId}" class="bg-claim text-white px-4 py-2 rounded-md text-sm">Yes, I filed it ✓</button>
    </div></div>`;
  $("modal").classList.remove("hidden");
}

document.addEventListener("click", async (e) => {
  const t = e.target;
  if (t.id === "scan") render(await api("/api/refresh", {}));
  if (t.id === "toggle-settings") $("settings").classList.toggle("hidden");
  if (t.id === "cta-prices") { $("settings").classList.remove("hidden"); $("settings").scrollIntoView({ behavior: "smooth" }); }
  if (t.id === "close-modal") $("modal").classList.add("hidden");

  // --- Setup wizard ---
  if (t.dataset.wizBack) wizStep(Number(t.dataset.wizBack));
  if (t.dataset.wizNext === "1") {
    const token = $("wiz-token").value.trim();
    if (!token) return alert("Paste your RTT app token to continue.");
    // Save the token without re-rendering (that would wipe the wizard). Just advance the step.
    STATE = await api("/api/config", { rtt: { token }, demo: false });
    wizStep(2);
  }
  if (t.dataset.wizNext === "2") {
    if (!$("wiz-home").value || !$("wiz-dest").value) return alert("Enter both your home and destination stations.");
    wizStep(3);
  }
  if (t.dataset.wizNext === "3") {
    if (![...document.querySelectorAll(".wiz-day:checked")].length) return alert("Pick at least one travel day.");
    wizStep(4); // prices (optional)
  }
  // Finish with the prices entered; Skip finishes with none. Both create the routes and backfill.
  if (t.id === "wiz-finish") return finishWizard(faresFrom(document.querySelectorAll(".wiz-fare")));
  if (t.id === "wiz-skip") return finishWizard({});
  if (t.id === "wiz-demo") render(await api("/api/config", { demo: true }));

  if (t.dataset.claim) {
    const tk = STATE.tickets.find((x) => x.id === t.dataset.claim);
    if (tk?.portalUrl) window.open(tk.portalUrl, "_blank"); // open the operator's own Delay Repay form — the only place a claim can actually be filed
    confirmFiled(t.dataset.claim);
  }

  if (t.dataset.filed) {
    $("modal").classList.add("hidden");
    render(await api("/api/filed", { id: t.dataset.filed }));
    showToast("Logged. That's their problem now 🫡");
  }

  if (t.id === "route-add") {
    const f = $("config-form");
    if (!f.rLabel.value || !f.rOrigin.value || !f.rDest.value || !f.rFrom.value || !f.rTo.value) return alert("Fill in label, both stations and the time window.");
    // New routes start fareless; prices are added via the per-type inputs that appear on the route row.
    render(await api("/api/routes", { label: f.rLabel.value, origin: f.rOrigin.value, destination: f.rDest.value, fromTime: f.rFrom.value, toTime: f.rTo.value, confirm: f.rConfirm.checked }));
    $("settings").classList.remove("hidden");
  }
  if (t.dataset.routeDel) {
    // If this entry represents a mirrored pair (outbound + return), delete both.
    if (t.dataset.routeDelMirror) await api("/api/routes/delete", { id: t.dataset.routeDelMirror });
    render(await api("/api/routes/delete", { id: t.dataset.routeDel }));
    $("settings").classList.remove("hidden");
  }
  if (t.dataset.confirm) render(await api("/api/ticket/confirm", { id: t.dataset.confirm }));
  if (t.dataset.del && confirm("Stop tracking this journey and remove it?")) render(await api("/api/ticket/delete", { id: t.dataset.del }));
});

document.addEventListener("change", async (e) => {
  const el = e.target;
  // Global default — re-types and re-prices every route ticket (pending and arrived); emailed tickets keep their receipt type.
  if (el.id === "default-type") return render(await api("/api/config", { defaultTicketType: el.value }));
  // Per-ticket overrides for a route-monitored ticket: operator (fixes the wrong-train guess) and type.
  if (el.dataset.tickettype) return render(await api("/api/ticket/details", { id: el.dataset.tickettype, ticketType: el.value }));
  // Per-route fares: re-gather every type's £ input for this route into one pence table and save it.
  // Server re-prices that route's eligible tickets. Blank inputs are omitted (that type stays unknown).
  if (el.dataset.routeFare) {
    const id = el.dataset.routeFare;
    render(await api("/api/routes/fare", { id, fares: collectFares(id) }));
    showToast("Prices saved. How are they getting away with this? 💸");
    return;
  }
});

document.addEventListener("submit", async (e) => {
  if (e.target.id !== "config-form") return;
  e.preventDefault();
  const f = new FormData(e.target);
  const cfg = { scanDays: Number(f.get("scanDays")), demo: !!f.get("demoMode") };
  if (f.get("rttToken")) cfg.rtt = { token: f.get("rttToken"), ...(f.get("rttUser") ? { user: f.get("rttUser") } : {}) };
  render(await api("/api/config", cfg));
});

// Fare inputs live inside the settings <form>. Pressing Enter would submit the whole config form
// (which patches demo:false and can trigger the setup wizard). Intercept Enter on fare inputs:
// prevent the submit and blur instead, which triggers the change handler that saves just the fare.
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches("[data-route-fare]")) {
    e.preventDefault();
    e.target.blur();
  }
});

// Populate the shared station datalist once; inputs reference it via list="stations".
api("/api/stations").then((names) => {
  if (!Array.isArray(names)) return; // defensive: never feed an error payload into the datalist
  $("stations").innerHTML = names.map((n) => `<option value="${n}"></option>`).join("");
});

api("/api/state").then(render);
