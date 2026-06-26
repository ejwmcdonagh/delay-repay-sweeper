import type { AppState, Config } from "./store.js";
import { save, upsertTicket } from "./store.js";
import type { ArrivalProvider } from "./arrival/provider.js";
import type { ClaimExecutor, ClaimResult } from "./claim/executor.js";
import { buildClaimPayload, claimPortal, portalFor } from "./claim/executor.js";
import { claimReadiness } from "./claim/requirements.js";
import { routeTicket, runsOn, type Route } from "./routes.js";
import { randomUUID } from "node:crypto";
import type { Ticket } from "./types.js";
import type { TicketExtras } from "./types.js";
import { validateTicket } from "./validate.js";
import { assessDelay, type TicketType } from "./eligibility.js";
import { schemeForToc } from "./toc/schemes.js";
import { toCrs } from "./stations.js";
import type { HspBackfiller } from "./arrival/hsp.js";
import { firstPollAt, isDue } from "./schedule/poll.js";
import { needsDeadlineAlert } from "./deadline.js";
import { computeMetrics } from "./metrics.js";
import { demoRoute } from "./demo.js";
import { notify, formatSuccess } from "./notify.js";

export interface Ctx {
  statePath: string;
  passphrase: string;
  state: AppState;
  provider: ArrivalProvider;
  executor: ClaimExecutor; // manual helper — opens the portal + copies fields (no TOC has a claim API)
  demo: boolean;
  /** Rebuilds the arrival provider from config, so saving an RTT token takes effect immediately. */
  buildProvider?: (config: Config) => ArrivalProvider;
}

/**
 * Apply a config patch and re-derive runtime state. Rebuilds the arrival provider so saving an RTT
 * token (or toggling demo) takes effect immediately rather than needing a daemon restart.
 */
export function applyConfig(ctx: Ctx, patch: Partial<Config>): void {
  Object.assign(ctx.state.config, patch);
  // Demo is an explicit opt-in. On -> seed the sample route so the no-credentials experience has
  // something to show; off -> drop it so live mode never queries the sample journey for real.
  if (ctx.state.config.demo) {
    if (!ctx.state.config.routes?.length) ctx.state.config.routes = [demoRoute()];
  } else {
    ctx.state.config.routes = (ctx.state.config.routes ?? []).filter((r) => r.id !== "demo-route");
  }
  if (ctx.buildProvider) {
    ctx.provider = ctx.buildProvider(ctx.state.config);
    ctx.demo = !!ctx.state.config.demo;
  }
  // When the global default type changes, re-type and re-price all existing route tickets so the
  // user's choice takes effect immediately instead of only applying to future sweeps.
  if (patch.defaultTicketType) rerouteTicketsByType(ctx, patch.defaultTicketType);
  persist(ctx);
}

// Update every resolved route ticket to a new ticket type, re-pricing from the route's stored fare.
// Used when the global default type changes — existing tickets must reflect the new type so the
// refund table shows £ rather than the band-only placeholder.
function rerouteTicketsByType(ctx: Ctx, ticketType: TicketType): void {
  const routes = ctx.state.config.routes ?? [];
  ctx.state.tickets = ctx.state.tickets.map((t) => {
    if (!t.fromRoute) return t; // emailed tickets keep the type from their receipt
    const route = routes.find((r) => r.origin === t.journey.origin && r.destination === t.journey.destination);
    const pricePence = route?.fares?.[ticketType] ?? 0;
    const journey = { ...t.journey, ticketType, pricePence };
    // Pending tickets have no arrival to band yet — re-type them but leave the assessment for the
    // next sweep; only re-band the ones that have already arrived.
    if (!t.actualArrival) return { ...t, journey };
    const assessment = assessDelay({
      scheduledArrival: new Date(t.journey.scheduledArrival),
      actualArrival: new Date(t.actualArrival),
      pricePence,
      ticketType,
      scheme: schemeForToc(t.toc),
    });
    return { ...t, journey, assessment };
  });
}

// One physical train = one claim. A route ticket's booking ref embeds the route id, so several
// overlapping watched routes (or a journey re-added during setup) each minted their own ticket for
// the same arrival. Collapse those by the journey itself, keeping the most-progressed copy so a
// claim already filed isn't dropped. Non-route tickets are left untouched.
const PROGRESS: Record<string, number> = { claimed: 4, rejected: 3, "action-required": 2, eligible: 1 };
export function dedupeRouteTickets(tickets: Ticket[]): Ticket[] {
  const journeyKey = (t: Ticket) => `${t.journey.origin}|${t.journey.destination}|${t.journey.scheduledArrival}`;
  const best = new Map<string, Ticket>();
  const out: Ticket[] = [];
  for (const t of tickets) {
    if (!t.fromRoute) {
      out.push(t);
      continue;
    }
    const key = journeyKey(t);
    const cur = best.get(key);
    if (!cur) {
      best.set(key, t);
      out.push(t);
    } else if ((PROGRESS[t.status] ?? 0) > (PROGRESS[cur.status] ?? 0)) {
      best.set(key, t);
      out[out.indexOf(cur)] = t; // replace the weaker duplicate in place
    }
  }
  return out;
}

function persist(ctx: Ctx): void {
  save(ctx.statePath, ctx.passphrase, ctx.state);
}

// Sweep every watched route's time window for delayed services and turn each into a ticket: a
// season-ticket / regular commuter just defines a route and a window.
async function sweepRoutes(ctx: Ctx, now: Date, quiet = false): Promise<void> {
  const routes = ctx.state.config.routes ?? [];
  if (!routes.length || !ctx.provider.servicesInWindow) return;
  const ticketType = ctx.state.config.defaultTicketType ?? "single";
  for (const route of routes) {
    if (!runsOn(route, now)) continue; // skip days the commuter doesn't travel
    const destCrs = toCrs(route.destination);
    if (!destCrs) continue;
    const services = await ctx.provider.servicesInWindow(destCrs, now, route.fromTime, route.toTime).catch(() => []);
    const originCrs = toCrs(route.origin);
    let created = 0;
    // Walk the board in time order so a cancelled service can fold into the next train actually
    // taken: the delay is then measured from when the user was *due* to arrive, not the later
    // train's own schedule (which would understate it).
    const sorted = [...services].sort((a, b) => a.scheduledArrival.getTime() - b.scheduledArrival.getTime());
    let cancelledFrom: Date | null = null; // scheduled arrival of the earliest cancelled service in a run
    for (const s of sorted) {
      // The arrivals board lists every train reaching the destination; keep only those that started
      // at the origin the user selected, so a Henley→Paddington route doesn't surface every arrival
      // into Paddington. Skipped only when the feed omits origin (degrade to showing all, not none).
      // ponytail: matches the originating station; a journey needing a change of train isn't covered.
      if (originCrs && s.originCrs && s.originCrs !== originCrs) continue;
      if (s.cancelled) {
        if (cancelledFrom === null) cancelledFrom = s.scheduledArrival; // remember the due time, claim it on the next train
        continue;
      }
      if (!s.actualArrival) continue; // not arrived yet

      // A cancellation before this train means the user was due on the cancelled service.
      const scheduledArrival = cancelledFrom ?? s.scheduledArrival;
      const cancelledConnection = cancelledFrom !== null;
      cancelledFrom = null;

      // Dedup on the physical journey, not the route id, so two overlapping routes don't both mint
      // a ticket for the same arrival.
      const arrivalIso = scheduledArrival.toISOString();
      if (ctx.state.tickets.some((t) => t.fromRoute && t.journey.origin === route.origin && t.journey.destination === route.destination && t.journey.scheduledArrival === arrivalIso)) continue;
      const assessment = assessDelay({ scheduledArrival, actualArrival: s.actualArrival, pricePence: route.fares?.[ticketType] ?? 0, ticketType, scheme: schemeForToc(s.toc ?? "") });
      if (!assessment.eligible) continue; // only surface delayed services, not every commuter train
      const t = routeTicket(route, scheduledArrival, ticketType);
      // With confirm on, hold delayed services for the user to pick which they boarded; the group
      // notification is sent below, so mark them notified to keep the eligible-alert loop off them.
      const status = route.confirm ? "awaiting-confirmation" : "eligible";
      // Use the operating TOC from live data (when present) so the claim links to the right portal.
      ctx.state.tickets = upsertTicket(ctx.state.tickets, { ...t, toc: s.toc ?? t.toc, actualArrival: s.actualArrival.toISOString(), assessment, status, cancelledConnection: cancelledConnection || undefined, notified: route.confirm || undefined });
      created++;
    }
    if (route.confirm && created > 0 && !quiet) {
      notify("Delay Repay", `${created} train${created > 1 ? "s" : ""} on your ${route.label} were delayed today — confirm which you took in the dashboard.`);
    }
  }
}

/**
 * One-off import of the last `days` days of watched-route delays, run when setup finishes. Sweeps
 * each past day quietly, then marks the imported eligibles as notified — a 28-day backfill should
 * populate the dashboard, not fire 28 push alerts at once.
 */
export async function backfillRoutes(ctx: Ctx, days: number, now: Date = new Date()): Promise<void> {
  for (let i = 1; i <= days; i++) {
    const day = new Date(now);
    day.setUTCDate(day.getUTCDate() - i);
    await sweepRoutes(ctx, day, true);
  }
  ctx.state.tickets = ctx.state.tickets.map((t) => (t.fromRoute && !t.notified ? { ...t, notified: true } : t));
  persist(ctx);
}

/** Poll every due ticket once, sweep watched routes, and fire alerts. Safe to call on a timer. */
export async function sweep(ctx: Ctx, now: Date = new Date()): Promise<void> {
  // Heal any duplicate watched routes minted before addRoute deduped them, so we sweep (and bill the
  // arrival API for) each journey once, not N times. Keeps the first id so existing tickets keep theirs.
  if (ctx.state.config.routes) {
    const kept: Route[] = [];
    for (const r of ctx.state.config.routes) if (!kept.some((k) => sameRoute(k, r))) kept.push(r);
    ctx.state.config.routes = kept;
  }
  await sweepRoutes(ctx, now);
  for (const t of ctx.state.tickets) {
    if (t.status === "awaiting-arrival" && isDue(firstPollAt(new Date(t.journey.scheduledArrival)), now)) {
      // A transient provider/network error on one poll shouldn't fail the whole sweep — leave the
      // ticket awaiting and try again next tick.
      try {
        ctx.state.tickets = upsertTicket(ctx.state.tickets, await validateTicket(t, ctx.provider, now));
      } catch (e) {
        console.error(`poll failed for ${t.journey.bookingRef}:`, (e as Error).message);
      }
    }
  }
  // Notify once when a delay becomes claimable. This is the floor for every mode — including
  // notify-only — so a user who wants no automation still learns they're owed money.
  for (const t of ctx.state.tickets) {
    if (t.status === "eligible" && !t.notified) {
      // Watched-route tickets have no fare, so the amount is unknown until the user picks a ticket.
      const owed = (t.assessment?.refundPence ?? 0) > 0 ? `£${(t.assessment!.refundPence / 100).toFixed(2)}` : "Delay Repay";
      notify("Delay Repay", `You're owed ${owed} for your delayed ${t.toc || t.journey.retailer} journey — claim at ${claimPortal(t.toc)}`);
      ctx.state.tickets = upsertTicket(ctx.state.tickets, { ...t, notified: true });
    }
    if (needsDeadlineAlert(new Date(t.journey.scheduledArrival), t.status, now)) {
      notify("Delay Repay deadline", `Claim for ${t.journey.bookingRef} expires soon — action needed.`);
    }
  }
  // Heal any duplicate route tickets already in state (e.g. minted before this dedup existed).
  ctx.state.tickets = dedupeRouteTickets(ctx.state.tickets);
  persist(ctx);
}

// Nightly batch fallback: ask HSP for arrivals the live provider never confirmed. HSP needs both
// CRS ends, which the live ArrivalProvider seam doesn't carry, so it runs here over the backlog.
export async function backfill(ctx: Ctx, backfiller: HspBackfiller, now: Date = new Date()): Promise<void> {
  for (const t of ctx.state.tickets) {
    if (t.status !== "awaiting-arrival" && t.status !== "action-required") continue;
    const originCrs = toCrs(t.journey.origin);
    if (!originCrs || !t.destinationCrs) continue;
    const scheduled = new Date(t.journey.scheduledArrival);
    const actual = await backfiller.arrivalFor(originCrs, t.destinationCrs, scheduled).catch(() => null);
    if (!actual) continue;
    const assessment = assessDelay({ scheduledArrival: scheduled, actualArrival: actual, pricePence: t.journey.pricePence, ticketType: t.journey.ticketType, scheme: schemeForToc(t.toc) });
    ctx.state.tickets = upsertTicket(ctx.state.tickets, { ...t, actualArrival: actual.toISOString(), assessment, status: assessment.eligible ? "eligible" : "on-time" });
  }
  await sweep(ctx, now); // re-run notify/deadline over the freshly resolved tickets
}

export async function claim(ctx: Ctx, id: string): Promise<ClaimResult> {
  const ticket = ctx.state.tickets.find((t) => t.id === id);
  if (!ticket) throw new Error(`unknown ticket ${id}`);
  // action-required = automation gave up; the user still needs the manual helper (portal + copy
  // fields), so it claims through the same path as an eligible ticket.
  if (ticket.status !== "eligible" && ticket.status !== "action-required") throw new Error(`ticket ${id} is not eligible`);

  const portalUrl = claimPortal(ticket.toc);
  const payload = buildClaimPayload(ticket);

  // Don't hand off to the portal while required proof is missing (e.g. a paper ticket number).
  // Hand the gap back to the UI to collect, then the user re-submits.
  const { missing, accountRequired } = claimReadiness(ticket);
  if (missing.length) return { status: "needs-input", missing, accountRequired, portalUrl, payload };

  // No TOC exposes a claim API, so we never submit on the user's behalf — the manual helper just
  // opens the right portal and hands over copy-to-paste fields. The user files, then markFiled().
  const result = await ctx.executor.submit(ticket, payload, portalUrl);
  result.accountRequired = accountRequired;
  return result;
}

/** User confirms they've filed the claim on the portal — flip the ticket to claimed. */
export function markFiled(ctx: Ctx, id: string): void {
  const ticket = ctx.state.tickets.find((t) => t.id === id);
  if (!ticket) throw new Error(`unknown ticket ${id}`);
  ctx.state.tickets = upsertTicket(ctx.state.tickets, { ...ticket, status: "claimed", claimedAt: new Date().toISOString() });
  notify("Delay Repay", formatSuccess(ticket.assessment?.refundPence ?? 0, ticket.toc));
  persist(ctx);
}

/** Add a watched route (season-ticket / no-email monitoring). */
export function addRoute(ctx: Ctx, route: Omit<Route, "id">): void {
  const routes = ctx.state.config.routes ?? [];
  // Re-running the setup wizard (or a double-submit) used to append the same journey again, and each
  // duplicate route mints its own ticket for every delayed train — so the dashboard showed the same
  // service N times. Dedup on the journey definition (not the id) so a re-add is a no-op.
  if (routes.some((r) => sameRoute(r, route))) return;
  ctx.state.config.routes = [...routes, { ...route, id: randomUUID() }];
  persist(ctx);
}

/** Replace a watched route's per-type fare table and re-cost its already-assessed tickets, so a
 * season-ticket holder can put a £ on a journey we monitor without an email. The form always submits
 * the full table (types left blank are simply absent), so a straight replace is correct. */
export function setRouteFares(ctx: Ctx, id: string, fares: Partial<Record<TicketType, number>>): void {
  const routes = ctx.state.config.routes ?? [];
  const route = routes.find((r) => r.id === id);
  if (!route) throw new Error(`unknown route ${id}`);
  route.fares = fares;
  recostRouteTickets(ctx, route);
  // Sync fares to the mirror route (same days, reversed origin↔destination) so editing one leg
  // of a wizard-created round trip updates both without the user touching each separately.
  const sameDays = (a: Route, b: Route) =>
    JSON.stringify([...(a.days ?? [])].sort()) === JSON.stringify([...(b.days ?? [])].sort());
  const mirror = routes.find((r) => r.id !== id && r.origin === route.destination && r.destination === route.origin && sameDays(r, route));
  if (mirror) {
    mirror.fares = fares;
    recostRouteTickets(ctx, mirror);
  }
  persist(ctx);
}

// Re-price the route's already-assessed tickets when its fare changes, so existing eligible delays
// show a £ immediately instead of waiting for new arrivals. Only resolved (actualArrival) tickets
// can be re-banded; pending ones pick the fare up via routeTicket on their next sweep.
function recostRouteTickets(ctx: Ctx, route: Route): void {
  ctx.state.tickets = ctx.state.tickets.map((t) => {
    if (!t.fromRoute || !t.actualArrival || t.journey.origin !== route.origin || t.journey.destination !== route.destination) return t;
    const journey = { ...t.journey, pricePence: route.fares?.[t.journey.ticketType] ?? 0 };
    const assessment = assessDelay({
      scheduledArrival: new Date(t.journey.scheduledArrival),
      actualArrival: new Date(t.actualArrival),
      pricePence: journey.pricePence,
      ticketType: journey.ticketType,
      scheme: schemeForToc(t.toc),
    });
    return { ...t, journey, assessment };
  });
}

/** Two routes are "the same journey" when origin, destination, window and travel days all match. */
function sameRoute(a: Omit<Route, "id">, b: Omit<Route, "id">): boolean {
  return a.origin === b.origin && a.destination === b.destination && a.fromTime === b.fromTime && a.toTime === b.toTime
    && JSON.stringify([...(a.days ?? [])].sort()) === JSON.stringify([...(b.days ?? [])].sort());
}

export function removeRoute(ctx: Ctx, id: string): void {
  ctx.state.config.routes = (ctx.state.config.routes ?? []).filter((r) => r.id !== id);
  persist(ctx);
}

/**
 * Confirm which delayed train on a watched route was actually boarded: the chosen ticket becomes
 * claimable, the other candidates for that route+day are dropped. Resolves the season-ticket
 * ambiguity the daemon can't infer on its own.
 */
export function confirmJourney(ctx: Ctx, id: string): void {
  const chosen = ctx.state.tickets.find((t) => t.id === id);
  if (!chosen) throw new Error(`unknown ticket ${id}`);
  const group = chosen.journey.bookingRef.split(":").slice(0, 2).join(":") + ":"; // routeId:date:
  ctx.state.tickets = ctx.state.tickets
    .filter((t) => t.id === id || !(t.status === "awaiting-confirmation" && t.journey.bookingRef.startsWith(group)))
    .map((t) => (t.id === id ? { ...t, status: "eligible" } : t));
  persist(ctx);
}

/**
 * Override the details a route-monitored ticket can't know: which operator actually ran the leg
 * (the arrival board shows whatever train hit the platform — a Henley→Paddington rider's GWR leg
 * reads as Elizabeth line "XR"), and the ticket type. Re-bands the refund off the existing arrival.
 */
export function setTicketDetails(ctx: Ctx, id: string, patch: { ticketType?: import("./eligibility.js").TicketType; toc?: string }): void {
  const t = ctx.state.tickets.find((x) => x.id === id);
  if (!t) throw new Error(`unknown ticket ${id}`);
  let journey = t.journey;
  if (patch.ticketType) {
    journey = { ...journey, ticketType: patch.ticketType };
    // A route ticket re-prices to the watched route's stored fare for the newly-chosen type, so the
    // table's type dropdown actually moves the £ (an emailed ticket keeps its own fare from the receipt).
    if (t.fromRoute) {
      const route = (ctx.state.config.routes ?? []).find((r) => r.id === t.journey.bookingRef.split(":")[0]);
      if (route) journey = { ...journey, pricePence: route.fares?.[patch.ticketType] ?? 0 };
    }
  }
  const toc = patch.toc ?? t.toc;
  const assessment = t.actualArrival
    ? assessDelay({
        scheduledArrival: new Date(t.journey.scheduledArrival),
        actualArrival: new Date(t.actualArrival),
        pricePence: journey.pricePence,
        ticketType: journey.ticketType,
        scheme: schemeForToc(toc), // re-band under the (possibly just-changed) operator's scheme
      })
    : t.assessment;
  ctx.state.tickets = upsertTicket(ctx.state.tickets, { ...t, journey, toc, assessment });
  persist(ctx);
}

/** Drop a ticket the user doesn't want tracked (an unwanted route arrival, or leftover demo data). */
export function removeTicket(ctx: Ctx, id: string): void {
  ctx.state.tickets = ctx.state.tickets.filter((t) => t.id !== id);
  persist(ctx);
}

/** Merge user-supplied claim data (ticket number, smartcard ref, medium) into a ticket. */
export function setExtras(ctx: Ctx, id: string, extras: TicketExtras): void {
  const t = ctx.state.tickets.find((x) => x.id === id);
  if (!t) throw new Error(`unknown ticket ${id}`);
  ctx.state.tickets = upsertTicket(ctx.state.tickets, { ...t, extras: { ...t.extras, ...extras } });
  persist(ctx);
}

/** Read-model for the dashboard: sanitised config (no secrets) + tickets + metrics. */
export function view(ctx: Ctx) {
  const { rtt, hsp, ...safe } = ctx.state.config;
  return {
    config: {
      ...safe,
      hasRtt: !!rtt,
      demo: !!ctx.state.config.demo,
      hasHsp: !!hsp,
    },
    // Dedup in the read path too, so duplicates minted before this existed never show, even if no
    // sweep has run since. portalUrl is set only for operators with a verified Delay Repay portal
    // (toc/portals.json); the dashboard hides "Claim now" when it's absent.
    tickets: dedupeRouteTickets(ctx.state.tickets).map((t) => ({ ...t, portalUrl: portalFor(t.toc) })),
    metrics: computeMetrics(ctx.state.tickets),
  };
}
