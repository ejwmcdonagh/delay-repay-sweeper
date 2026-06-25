const $ = (id) => document.getElementById(id);
const gbp = (pence) => "£" + (pence / 100).toFixed(2);
const hhmm = (iso) => (iso ? new Date(iso).toISOString().slice(11, 16) : "—");
const date = (iso) => new Date(iso).toISOString().slice(0, 10);

let STATE = { config: {}, tickets: [], metrics: {} };

// Status badge styling. Emerald is reserved for money owed, per the PRD.
const BADGE = {
  "on-time": ["On Time", "bg-slate-100 text-slate-600"],
  eligible: ["Eligible: 15+ min", "bg-emerald-100 text-claim"],
  "awaiting-confirmation": ["Which train?", "bg-amber-100 text-warn"],
  "awaiting-arrival": ["Pending Arrival", "bg-amber-100 text-warn"],
  claimed: ["Claimed", "bg-blue-100 text-accent"],
  rejected: ["Rejected", "bg-red-100 text-red-600"],
  "action-required": ["Action Required", "bg-amber-100 text-warn"],
  scanned: ["Scanned", "bg-slate-100 text-slate-600"],
};

const MEDIA = ["eticket", "paper", "smartcard", "oyster", "contactless", "season"];
// Which missing-field keys belong to the saved profile vs. the per-ticket extras.
const IDENTITY_KEYS = { claimantName: "name", claimantEmail: "email", claimantAddress: "address", bankSortCode: "sortCode", bankAccountNumber: "accountNumber" };
const EXTRA_KEYS = { ticketNumber: "ticketNumber", smartcardRef: "smartcardRef", proofImage: "proofImagePath" };

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

function row(t) {
  const [label, cls] = BADGE[t.status] ?? ["—", "bg-slate-100"];
  const refund = t.assessment && t.assessment.refundPence > 0 ? gbp(t.assessment.refundPence) : t.fromRoute && t.status === "eligible" ? "check ticket" : "—";
  const delay = t.assessment ? `${t.assessment.delayMinutes} min` : "—";
  const action =
    t.status === "eligible"
      ? `<button data-claim="${t.id}" class="text-accent font-medium">Claim now</button>`
      : t.status === "awaiting-confirmation"
        ? `<button data-confirm="${t.id}" class="text-warn font-medium">I took this train</button>`
        : "";
  return `<tr class="border-t border-slate-100">
    <td class="px-4 py-2 font-mono">${date(t.journey.scheduledDeparture)}</td>
    <td class="px-4 py-2">${t.journey.origin} → ${t.journey.destination}</td>
    <td class="px-4 py-2">${t.toc || t.journey.retailer}</td>
    <td class="px-4 py-2 font-mono">${hhmm(t.journey.scheduledArrival)}</td>
    <td class="px-4 py-2 font-mono">${hhmm(t.actualArrival)}</td>
    <td class="px-4 py-2 font-mono">${delay}</td>
    <td class="px-4 py-2 font-mono ${t.status === "eligible" ? "text-claim font-semibold" : ""}">${refund}</td>
    <td class="px-4 py-2"><span class="px-2 py-1 rounded text-xs font-medium ${cls}">${label}</span></td>
    <td class="px-4 py-2 text-right">${action}</td></tr>`;
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

  $("mode").textContent = `${c.demo ? "Demo" : "Live"} · mode: ${c.mode}` + (c.hasEmail ? ` · ${c.emailUser} (${c.emailAuth})` : "");
  const m = state.metrics;
  $("metrics").innerHTML =
    metricCard("Total Reclaimed", gbp(m.totalReclaimedPence)) +
    metricCard("Pending Eligible Claims", `${m.pendingEligibleCount} · ${gbp(m.pendingEligiblePence)}`) +
    metricCard("Tickets Scanned This Month", m.scannedThisMonth);
  $("tickets").innerHTML = state.tickets.map(row).join("") || `<tr><td colspan="9" class="px-4 py-8 text-center text-slate-400">No tickets yet — click "Scan email".</td></tr>`;
  $("settings").innerHTML = settingsForm(c);
}

function modeOption(v, current) {
  const labels = { notify: "Notify only — I'll claim myself", manual: "Manual helper — copy fields for me", auto: "Auto — file claims headlessly" };
  return `<option value="${v}" ${v === current ? "selected" : ""}>${labels[v]}</option>`;
}

function routeList(routes) {
  if (!routes || !routes.length) return `<p class="text-sm text-slate-400">No watched routes yet.</p>`;
  return routes
    .map(
      (r) => `<div class="flex items-center justify-between bg-slate-50 rounded px-3 py-2 text-sm">
        <span>${r.label}: <b>${r.origin} → ${r.destination}</b> <span class="font-mono text-slate-500">${r.fromTime}–${r.toTime}</span>${r.confirm ? ' <span class="text-warn text-xs">· asks which train</span>' : ""}</span>
        <button data-route-del="${r.id}" class="text-red-500">Remove</button></div>`,
    )
    .join("");
}

function settingsForm(c) {
  const id = c.identity ?? {};
  return `<form id="config-form" class="grid grid-cols-2 gap-3 text-sm">
    <label class="flex flex-col col-span-2">Mode
      <select name="mode" class="border rounded px-2 py-1 w-full">${["notify", "manual", "auto"].map((v) => modeOption(v, c.mode)).join("")}</select></label>

    <label class="col-span-2 flex items-center gap-2 text-sm"><input name="demoMode" type="checkbox" ${c.demo ? "checked" : ""} /> Demo mode — show sample data instead of tracking real journeys</label>

    <div class="col-span-2 border-t pt-2 mt-1 text-slate-500 text-xs uppercase tracking-wide">Watched routes — the easy way, no email needed</div>
    <p class="col-span-2 text-xs text-slate-500">Add a regular journey and a time window. We'll watch every train in that window and alert you when one is delayed 15+ minutes — no inbox to connect.</p>
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

    <div class="col-span-2 border-t pt-2 mt-1 text-slate-500 text-xs uppercase tracking-wide">Inbox (optional — only if you want tickets read automatically)</div>
    <label class="flex flex-col">IMAP user<input name="emailUser" class="border rounded px-2 py-1" value="${c.emailUser ?? ""}" /></label>
    <label class="flex flex-col">IMAP app password<input name="emailPass" type="password" class="border rounded px-2 py-1" /></label>
    <label class="flex flex-col">IMAP host<input name="emailHost" class="border rounded px-2 py-1" placeholder="imap.gmail.com" /></label>
    <label class="flex flex-col">IMAP port<input name="emailPort" class="border rounded px-2 py-1" placeholder="993" /></label>
    <div class="col-span-2 text-xs text-slate-500">Managed Gmail / Microsoft 365? Connect via OAuth instead of an app password:</div>
    <label class="flex flex-col">OAuth provider<select name="oauthProvider" class="border rounded px-2 py-1"><option value="google">Google</option><option value="microsoft">Microsoft 365</option></select></label>
    <label class="flex flex-col">OAuth client ID (your app)<input name="oauthClientId" class="border rounded px-2 py-1" /></label>
    <button type="button" id="oauth-connect" class="col-span-2 border border-accent text-accent px-4 py-2 rounded-md w-fit">Connect inbox via OAuth ↗</button>

    <div class="col-span-2 border-t pt-2 mt-1 text-slate-500 text-xs uppercase tracking-wide">Train data (Realtime Trains)</div>
    <p class="col-span-2 text-xs text-slate-500">Get a free token at <span class="font-mono">api-portal.rtt.io</span> (personal use). Paste it below to fetch live arrivals.</p>
    <div class="col-span-2 text-sm font-medium ${c.hasRtt ? "text-claim" : "text-slate-400"}">${c.hasRtt ? "✓ RTT token saved" : "○ No RTT token yet"}</div>
    <label class="flex flex-col col-span-2">RTT token (Next Gen)<input name="rttToken" type="password" class="border rounded px-2 py-1" placeholder="${c.hasRtt ? "•••••• saved (paste again to replace)" : "paste token here"}" /></label>
    <label class="flex flex-col col-span-2 text-xs text-slate-400">Legacy api.rtt.io username (only if using the old API — leave blank)<input name="rttUser" class="border rounded px-2 py-1" /></label>

    <div class="col-span-2 border-t pt-2 mt-1 text-slate-500 text-xs uppercase tracking-wide">Claim profile (used to fill forms)</div>
    <label class="flex flex-col">Full name<input name="idName" class="border rounded px-2 py-1" value="${id.name ?? ""}" /></label>
    <label class="flex flex-col">Email<input name="idEmail" class="border rounded px-2 py-1" value="${id.email ?? ""}" /></label>
    <label class="flex flex-col col-span-2">Postal address<input name="idAddress" class="border rounded px-2 py-1" value="${id.address ?? ""}" /></label>
    <label class="flex flex-col">Bank sort code<input name="idSort" class="border rounded px-2 py-1 font-mono" value="${id.sortCode ?? ""}" /></label>
    <label class="flex flex-col">Bank account number<input name="idAcct" class="border rounded px-2 py-1 font-mono" value="${id.accountNumber ?? ""}" /></label>

    <label class="flex flex-col col-span-2">Scan past days (7–28)<input name="scanDays" type="number" min="7" max="28" value="${c.scanDays}" class="border rounded px-2 py-1 w-32" /></label>
    <button class="col-span-2 bg-accent text-white px-4 py-2 rounded-md w-fit">Save settings</button>
  </form>`;
}

// Mon-first day picker; values are JS getUTCDay numbers (0=Sun..6=Sat). Mon–Fri checked by default.
const DAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"]];

function wizardHtml() {
  return `
  <h2 class="text-lg font-semibold mb-1">Set up Delay Repay Sweeper</h2>
  <p class="text-sm text-slate-500 mb-5">Three quick steps, then we'll track your trains and check the last 28 days.</p>

  <div data-step="1" class="space-y-3">
    <h3 class="font-medium">Step 1 of 3 · Connect train data</h3>
    <ol class="text-sm text-slate-600 list-decimal pl-5 space-y-1">
      <li>Open <span class="font-mono">api-portal.rtt.io</span> and sign up — free, for personal use.</li>
      <li>Create an app token under your account.</li>
      <li>Paste it below.</li>
    </ol>
    <input id="wiz-token" type="password" class="border rounded px-2 py-1 w-full" placeholder="RTT app token" />
    <div class="flex justify-end"><button data-wiz-next="1" class="bg-accent text-white px-4 py-2 rounded-md text-sm">Save & continue</button></div>
  </div>

  <div data-step="2" class="space-y-3 hidden">
    <h3 class="font-medium">Step 2 of 3 · Your journey & times</h3>
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
    <h3 class="font-medium">Step 3 of 3 · Which days do you travel?</h3>
    <div class="flex flex-wrap gap-2 text-sm">
      ${DAYS.map(([n, l]) => `<label class="flex items-center gap-1 border rounded px-3 py-1"><input type="checkbox" class="wiz-day" value="${n}" ${n >= 1 && n <= 5 ? "checked" : ""}/> ${l}</label>`).join("")}
    </div>
    <div class="flex justify-between"><button data-wiz-back="2" class="text-slate-500 text-sm">← Back</button><button id="wiz-finish" class="bg-claim text-white px-4 py-2 rounded-md text-sm">Finish & start tracking</button></div>
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

function copyBtn(label, value) {
  return `<button data-copy="${encodeURIComponent(value)}" class="flex justify-between w-full bg-slate-100 hover:bg-slate-200 rounded px-3 py-2 text-left text-sm">
    <span class="text-slate-500">${label}</span><span class="font-mono">${value}</span></button>`;
}

function mediumSelect(ticketId, current) {
  return `<label class="flex items-center gap-2 text-sm mb-3">Ticket type
    <select data-medium="${ticketId}" class="border rounded px-2 py-1">
      ${MEDIA.map((m) => `<option value="${m}" ${m === current ? "selected" : ""}>${m}</option>`).join("")}
    </select></label>`;
}

// Single claim modal: medium selector + account-login warning + either missing-field inputs
// (needs-input) or the copy helper (manual). Notify mode shows only the portal link.
function openClaim(ticketId, result) {
  const t = STATE.tickets.find((x) => x.id === ticketId);
  const medium = t?.extras?.ticketMedium ?? "eticket";
  const notify = STATE.config.mode === "notify";
  let inner = "";

  if (result.accountRequired)
    inner += `<div class="bg-amber-50 text-warn text-sm rounded px-3 py-2 mb-3">This operator requires an account login — sign in on the portal first, then claim.</div>`;

  inner += `<a href="${result.portalUrl}" target="_blank" class="inline-block bg-accent text-white px-4 py-2 rounded-md text-sm mb-4">Open ${t?.toc || ""} Delay Repay portal ↗</a>`;
  inner += mediumSelect(ticketId, medium);

  if (result.status === "needs-input") {
    inner += `<p class="text-sm text-slate-500 mb-2">A few details aren't in your email — add them to continue:</p>`;
    inner += result.missing.map((f) => `<label class="flex flex-col text-sm mb-2">${f.label}<input data-field="${f.key}" class="border rounded px-2 py-1" /></label>`).join("");
    inner += `<button id="needs-continue" data-id="${ticketId}" class="bg-claim text-white px-4 py-2 rounded-md text-sm mt-1">Save & continue</button>`;
  } else if (result.status === "submitted") {
    inner += `<div class="text-claim font-medium">Submitted ✓</div>`;
  } else if (!notify && result.payload) {
    const p = result.payload;
    inner += `<div class="space-y-2">
      ${copyBtn("Booking reference", p.bookingRef)}
      ${p.ticketNumber ? copyBtn("Ticket number", p.ticketNumber) : ""}
      ${copyBtn("Origin", p.origin)}
      ${copyBtn("Destination", p.destination)}
      ${copyBtn("Scheduled arrival", hhmm(p.scheduledArrival))}
      ${copyBtn("Actual arrival", hhmm(p.actualArrival))}
      ${copyBtn("Delay (minutes)", String(p.delayMinutes))}
      ${copyBtn("Refund due", gbp(p.refundPence))}
    </div>`;
  } else if (notify) {
    inner += `<p class="text-sm text-slate-500">Notify-only mode — open the portal above and claim manually.</p>`;
  }

  $("modal").innerHTML = `<div class="bg-white rounded-lg w-full max-w-2xl p-5">
    <div class="flex justify-between items-center mb-3"><h2 class="font-semibold">File your claim</h2><button id="close-modal" class="text-slate-400">✕</button></div>
    ${inner}</div>`;
  $("modal").classList.remove("hidden");
}

document.addEventListener("click", async (e) => {
  const t = e.target;
  if (t.id === "scan") render(await api("/api/scan", {}));
  if (t.id === "toggle-settings") $("settings").classList.toggle("hidden");
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
  if (t.id === "wiz-finish") {
    const home = $("wiz-home").value, dest = $("wiz-dest").value;
    const days = [...document.querySelectorAll(".wiz-day:checked")].map((el) => Number(el.value));
    if (!days.length) return alert("Pick at least one travel day.");
    // Outbound + return become two watched routes sharing the same travel days.
    await api("/api/routes", { label: `${home} → ${dest}`, origin: home, destination: dest, fromTime: $("wiz-out-from").value, toTime: $("wiz-out-to").value, days });
    await api("/api/routes", { label: `${dest} → ${home}`, origin: dest, destination: home, fromTime: $("wiz-ret-from").value, toTime: $("wiz-ret-to").value, days });
    render(await api("/api/backfill", {})); // import the last 28 days, then show the dashboard
  }
  if (t.id === "wiz-demo") render(await api("/api/config", { demo: true }));

  if (t.dataset.claim) openClaim(t.dataset.claim, await api("/api/claim", { id: t.dataset.claim }));

  if (t.id === "needs-continue") {
    const id = t.dataset.id;
    const inputs = [...document.querySelectorAll("[data-field]")];
    const identity = { ...(STATE.config.identity ?? {}) };
    const extras = {};
    for (const el of inputs) {
      if (!el.value) continue;
      if (IDENTITY_KEYS[el.dataset.field]) identity[IDENTITY_KEYS[el.dataset.field]] = el.value;
      if (EXTRA_KEYS[el.dataset.field]) extras[EXTRA_KEYS[el.dataset.field]] = el.value;
    }
    await api("/api/config", { identity });
    if (Object.keys(extras).length) await api("/api/ticket/extras", { id, extras });
    openClaim(id, await api("/api/claim", { id })); // re-evaluate now the gaps are filled
    render(await api("/api/state"));
  }

  if (t.id === "route-add") {
    const f = $("config-form");
    if (!f.rLabel.value || !f.rOrigin.value || !f.rDest.value || !f.rFrom.value || !f.rTo.value) return alert("Fill in label, both stations and the time window.");
    render(await api("/api/routes", { label: f.rLabel.value, origin: f.rOrigin.value, destination: f.rDest.value, fromTime: f.rFrom.value, toTime: f.rTo.value, confirm: f.rConfirm.checked }));
    $("settings").classList.remove("hidden");
  }
  if (t.dataset.routeDel) {
    render(await api("/api/routes/delete", { id: t.dataset.routeDel }));
    $("settings").classList.remove("hidden");
  }
  if (t.dataset.confirm) render(await api("/api/ticket/confirm", { id: t.dataset.confirm }));

  if (t.id === "oauth-connect") {
    const f = $("config-form");
    if (!f.oauthClientId.value || !f.emailUser.value) return alert("Enter your OAuth client ID and email address first.\n\nTip: most people don't need this — just add a watched route above.");
    alert("A browser window will open to authorise your inbox.");
    render(await api("/api/oauth/connect", { provider: f.oauthProvider.value, clientId: f.oauthClientId.value, email: f.emailUser.value }));
  }

  if (t.dataset.copy) {
    navigator.clipboard.writeText(decodeURIComponent(t.dataset.copy));
    t.classList.add("ring", "ring-claim");
    setTimeout(() => t.classList.remove("ring", "ring-claim"), 600);
  }
});

document.addEventListener("change", async (e) => {
  if (!e.target.dataset.medium) return;
  const id = e.target.dataset.medium;
  await api("/api/ticket/extras", { id, extras: { ticketMedium: e.target.value } });
  render(await api("/api/state"));
  openClaim(id, await api("/api/claim", { id })); // medium change may surface new required fields
});

document.addEventListener("submit", async (e) => {
  if (e.target.id !== "config-form") return;
  e.preventDefault();
  const f = new FormData(e.target);
  const cfg = { mode: f.get("mode"), scanDays: Number(f.get("scanDays")), demo: !!f.get("demoMode") };
  if (f.get("emailUser") && f.get("emailPass")) cfg.email = { user: f.get("emailUser"), password: f.get("emailPass"), host: f.get("emailHost") || "imap.gmail.com", port: Number(f.get("emailPort") || 993) };
  if (f.get("rttToken")) cfg.rtt = { token: f.get("rttToken"), ...(f.get("rttUser") ? { user: f.get("rttUser") } : {}) };
  cfg.identity = { name: f.get("idName"), email: f.get("idEmail"), address: f.get("idAddress"), sortCode: f.get("idSort"), accountNumber: f.get("idAcct") };
  render(await api("/api/config", cfg));
});

// Populate the shared station datalist once; inputs reference it via list="stations".
api("/api/stations").then((names) => {
  if (!Array.isArray(names)) return; // defensive: never feed an error payload into the datalist
  $("stations").innerHTML = names.map((n) => `<option value="${n}"></option>`).join("");
});

api("/api/state").then(render);
