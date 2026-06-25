import { randomUUID } from "node:crypto";
import type { Ticket } from "./types.js";
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

/** A ticket for one delayed service found on a watched route. No fare — refund is unknown. */
export function routeTicket(route: Route, scheduled: Date): Ticket {
  return {
    id: randomUUID(),
    journey: {
      retailer: "route",
      bookingRef: routeBookingRef(route, scheduled),
      origin: route.origin,
      destination: route.destination,
      scheduledDeparture: scheduled.toISOString(),
      scheduledArrival: scheduled.toISOString(),
      pricePence: 0,
      ticketType: "single",
    },
    destinationCrs: toCrs(route.destination) ?? "",
    toc: "",
    status: "awaiting-arrival",
    pollAttempts: 0,
    fromRoute: true,
  };
}
