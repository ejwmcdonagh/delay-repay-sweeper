import type { AppState, Config } from "./store.js";
import { save, upsertTicket } from "./store.js";
import type { ArrivalProvider } from "./arrival/provider.js";
import type { ClaimExecutor, ClaimResult } from "./claim/executor.js";
import { buildClaimPayload, claimPortal } from "./claim/executor.js";
import { claimReadiness } from "./claim/requirements.js";
import { routeBookingRef, routeTicket, runsOn, type Route } from "./routes.js";
import { randomUUID } from "node:crypto";
import type { Ticket } from "./types.js";
import { ingestEmails } from "./ingest/ingest.js";
import { fetchRecentEmails, type ImapConfig } from "./ingest/imap.js";
import { isExpired, refreshAccessToken, authorize, type OAuthProvider } from "./ingest/oauth.js";
import type { TicketExtras } from "./types.js";
import { scanSince } from "./ingest/window.js";
import { validateTicket } from "./validate.js";
import { assessDelay } from "./eligibility.js";
import { toCrs } from "./stations.js";
import type { HspBackfiller } from "./arrival/hsp.js";
import { firstPollAt, isDue } from "./schedule/poll.js";
import { needsDeadlineAlert } from "./deadline.js";
import { computeMetrics } from "./metrics.js";
import { demoEmails, demoRoute } from "./demo.js";
import { notify, formatSuccess } from "./notify.js";

export interface Ctx {
  statePath: string;
  passphrase: string;
  state: AppState;
  provider: ArrivalProvider;
  executor: ClaimExecutor; // manual helper — used by notify/manual modes
  autoExecutor?: ClaimExecutor; // headless filer — used only in auto mode, if configured
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
  persist(ctx);
}

/** Add incoming tickets whose booking reference we don't already track. */
export function mergeTickets(existing: Ticket[], incoming: Ticket[]): Ticket[] {
  const seen = new Set(existing.map((t) => t.journey.bookingRef));
  return [...existing, ...incoming.filter((t) => !seen.has(t.journey.bookingRef))];
}

function persist(ctx: Ctx): void {
  save(ctx.statePath, ctx.passphrase, ctx.state);
}

// Resolve IMAP auth, refreshing the OAuth access token (and persisting the new one) when it's
// expired so the daemon never needs to re-prompt for consent.
async function resolveImapConfig(ctx: Ctx): Promise<ImapConfig> {
  const e = ctx.state.config.email!;
  if (!e.oauth) return { user: e.user, host: e.host, port: e.port, password: e.password };
  if (!e.oauth.accessToken || !e.oauth.expiry || isExpired(e.oauth.expiry)) {
    const set = await refreshAccessToken(e.oauth.provider, { clientId: e.oauth.clientId, refreshToken: e.oauth.refreshToken });
    e.oauth.accessToken = set.accessToken;
    e.oauth.expiry = set.expiry;
    e.oauth.refreshToken = set.refreshToken ?? e.oauth.refreshToken;
    persist(ctx);
  }
  return { user: e.user, host: e.host, port: e.port, accessToken: e.oauth.accessToken };
}

export async function scan(ctx: Ctx): Promise<void> {
  // Demo mode -> sample emails. Live with an inbox -> fetch it. Live without an inbox (route-only
  // user) -> no emails at all; don't fabricate demo tickets, which would then be polled for real.
  const emails = ctx.demo
    ? demoEmails()
    : ctx.state.config.email
      ? await fetchRecentEmails(await resolveImapConfig(ctx), scanSince(ctx.state.config.scanDays))
      : [];
  ctx.state.tickets = mergeTickets(ctx.state.tickets, ingestEmails(emails));
  persist(ctx);
}

// Sweep every watched route's time window for delayed services and turn each into a ticket. This
// is the no-email path: a season-ticket / regular commuter just defines a route and a window.
async function sweepRoutes(ctx: Ctx, now: Date, quiet = false): Promise<void> {
  const routes = ctx.state.config.routes ?? [];
  if (!routes.length || !ctx.provider.servicesInWindow) return;
  for (const route of routes) {
    if (!runsOn(route, now)) continue; // skip days the commuter doesn't travel
    const destCrs = toCrs(route.destination);
    if (!destCrs) continue;
    const services = await ctx.provider.servicesInWindow(destCrs, now, route.fromTime, route.toTime).catch(() => []);
    let created = 0;
    for (const s of services) {
      if (!s.actualArrival) continue; // not arrived yet
      const ref = routeBookingRef(route, s.scheduledArrival);
      if (ctx.state.tickets.some((t) => t.journey.bookingRef === ref)) continue; // already tracked
      const assessment = assessDelay({ scheduledArrival: s.scheduledArrival, actualArrival: s.actualArrival, pricePence: 0, ticketType: "single" });
      if (!assessment.eligible) continue; // only surface delayed services, not every commuter train
      const t = routeTicket(route, s.scheduledArrival);
      // With confirm on, hold delayed services for the user to pick which they boarded; the group
      // notification is sent below, so mark them notified to keep the eligible-alert loop off them.
      const status = route.confirm ? "awaiting-confirmation" : "eligible";
      // Use the operating TOC from live data (when present) so the claim links to the right portal.
      ctx.state.tickets = upsertTicket(ctx.state.tickets, { ...t, toc: s.toc ?? t.toc, actualArrival: s.actualArrival.toISOString(), assessment, status, notified: route.confirm || undefined });
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
    const assessment = assessDelay({ scheduledArrival: scheduled, actualArrival: actual, pricePence: t.journey.pricePence, ticketType: t.journey.ticketType });
    ctx.state.tickets = upsertTicket(ctx.state.tickets, { ...t, actualArrival: actual.toISOString(), assessment, status: assessment.eligible ? "eligible" : "on-time" });
  }
  await sweep(ctx, now); // re-run notify/deadline over the freshly resolved tickets
}

export async function claim(ctx: Ctx, id: string): Promise<ClaimResult> {
  const ticket = ctx.state.tickets.find((t) => t.id === id);
  if (!ticket) throw new Error(`unknown ticket ${id}`);
  if (ticket.status !== "eligible") throw new Error(`ticket ${id} is not eligible`);

  const portalUrl = claimPortal(ticket.toc);
  const payload = buildClaimPayload(ticket, ctx.state.config.identity);

  // Don't attempt submission while required data is missing (e.g. a paper ticket number, or bank
  // details). Hand the gap back to the UI to collect, then the user re-submits.
  const { missing, accountRequired } = claimReadiness(ticket, ctx.state.config.identity);
  if (missing.length) return { status: "needs-input", missing, accountRequired, portalUrl, payload };

  // Pick the executor from the live mode, so changing mode in Settings takes effect immediately.
  const executor = ctx.state.config.mode === "auto" && ctx.autoExecutor ? ctx.autoExecutor : ctx.executor;
  const result = await executor.submit(ticket, payload, portalUrl);
  result.accountRequired = accountRequired;

  if (result.status === "submitted") {
    ctx.state.tickets = upsertTicket(ctx.state.tickets, { ...ticket, status: "claimed", claimRef: result.claimRef });
    notify("Delay Repay", formatSuccess(payload.refundPence, ticket.toc));
    persist(ctx);
  }
  return result;
}

/** Add a watched route (season-ticket / no-email monitoring). */
export function addRoute(ctx: Ctx, route: Omit<Route, "id">): void {
  ctx.state.config.routes = [...(ctx.state.config.routes ?? []), { ...route, id: randomUUID() }];
  persist(ctx);
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

/** Merge user-supplied claim data (ticket number, smartcard ref, medium) into a ticket. */
export function setExtras(ctx: Ctx, id: string, extras: TicketExtras): void {
  const t = ctx.state.tickets.find((x) => x.id === id);
  if (!t) throw new Error(`unknown ticket ${id}`);
  ctx.state.tickets = upsertTicket(ctx.state.tickets, { ...t, extras: { ...t.extras, ...extras } });
  persist(ctx);
}

// Default IMAP endpoints per OAuth provider so the user only supplies their email + client ID.
const IMAP_PRESET: Record<OAuthProvider, { host: string; port: number }> = {
  google: { host: "imap.gmail.com", port: 993 },
  microsoft: { host: "outlook.office365.com", port: 993 },
};

/** Run the BYO-client-ID OAuth loopback flow and store the resulting refresh token in the vault. */
export async function connectOauth(ctx: Ctx, opts: { provider: OAuthProvider; clientId: string; email: string }): Promise<void> {
  const tokens = await authorize(opts.provider, opts.clientId);
  ctx.state.config.email = {
    user: opts.email,
    ...IMAP_PRESET[opts.provider],
    oauth: { provider: opts.provider, clientId: opts.clientId, refreshToken: tokens.refreshToken!, accessToken: tokens.accessToken, expiry: tokens.expiry },
  };
  persist(ctx);
}

/** Read-model for the dashboard: sanitised config (no secrets) + tickets + metrics. */
export function view(ctx: Ctx) {
  const { email, rtt, hsp, captcha, identity, ...safe } = ctx.state.config;
  return {
    config: {
      ...safe,
      hasEmail: !!email,
      emailUser: email?.user,
      emailAuth: email?.oauth ? email.oauth.provider : email ? "password" : null,
      hasRtt: !!rtt,
      demo: !!ctx.state.config.demo,
      hasHsp: !!hsp,
      hasCaptcha: !!captcha,
      identity,
    },
    tickets: ctx.state.tickets,
    metrics: computeMetrics(ctx.state.tickets),
  };
}
