import { randomUUID } from "node:crypto";
import type { Ticket } from "./types.js";
import type { TicketType } from "./eligibility.js";
import { toCrs } from "./stations.js";

// A regular journey the user watches without connecting any email. Instead of one train it covers
// a time window — "Waterloo→Brighton, trains 06:30–10:00" — because a season-ticket / flexible
// commuter takes any service in that band. The daemon sweeps every service in the window and
// surfaces the delayed ones (the PRD's open-ticket sweeper).
export interface Route {
  id: string;
  label: string;
  origin: string;
  destination: string;
  /** Window bounds as "HH:mm" (UTC), matched against each service's scheduled time. */
  fromTime: string;
  toTime: string;
  /**
   * Days the journey is taken, as JS day numbers (0=Sun … 6=Sat). Omitted means every day. Set by
   * the setup wizard so a Mon–Fri commuter isn't swept (or backfilled) on weekends.
   */
  days?: number[];
  /**
   * Opt-in: when several trains in the window are delayed, ask which one was actually boarded
   * before treating it as a claim (a season-ticket holder has no reservation to prove it). Off by
   * default — each delayed service is surfaced on its own.
   */
  confirm?: boolean;
  /**
   * Fares for this journey keyed by ticket type, in integer pence (money is never a float on the
   * payout path). Each is the per-journey amount the refund is banded off: for a return, the whole
   * ticket (assessDelay halves it per leg); for season/travelcard/multi, your per-journey (daily- or
   * trip-equivalent) cost. A type that's missing = unknown, so that ticket shows the band with no £.
   */
  fares?: Partial<Record<TicketType, number>>;
}

/** Deterministic per route + day + service time, so re-sweeping never duplicates a service. */
export function routeBookingRef(route: Route, scheduled: Date): string {
  return `${route.id}:${scheduled.toISOString().slice(0, 10)}:${scheduled.toISOString().slice(11, 16)}`;
}

/** Whether a route is taken on `date`'s weekday. No `days` set = runs every day. */
export function runsOn(route: Route, date: Date): boolean {
  return !route.days || route.days.includes(date.getUTCDay());
}

export function withinWindow(scheduled: Date, fromTime: string, toTime: string): boolean {
  const hhmm = scheduled.toISOString().slice(11, 16);
  return hhmm >= fromTime && hhmm <= toTime;
}

/** A ticket for one delayed service found on a watched route. Carries the route's fare (if set) so
 * the refund can be costed; without one, refund is unknown and only the band is shown. */
export function routeTicket(route: Route, scheduled: Date, ticketType: TicketType = "single"): Ticket {
  return {
    id: randomUUID(),
    journey: {
      retailer: "route",
      bookingRef: routeBookingRef(route, scheduled),
      origin: route.origin,
      destination: route.destination,
      scheduledDeparture: scheduled.toISOString(),
      scheduledArrival: scheduled.toISOString(),
      pricePence: route.fares?.[ticketType] ?? 0,
      ticketType,
    },
    destinationCrs: toCrs(route.destination) ?? "",
    toc: "",
    status: "awaiting-arrival",
    pollAttempts: 0,
    fromRoute: true,
  };
}
