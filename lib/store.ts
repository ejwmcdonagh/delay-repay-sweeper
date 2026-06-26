import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { seal, open, type SealedBlob } from "./vault.js";
import type { Ticket } from "./types.js";

import type { Route } from "./routes.js";

export interface Config {
  // Next Gen RTT: just `token` (long-life token from api-portal.rtt.io). Old api.rtt.io basic auth
  // (deprecated, retires 30 Sep 2026) also supplies `user`.
  rtt?: { token: string; user?: string; baseUrl?: string };
  hsp?: { user: string; password: string };
  /** Watched journeys — the only ticket source. */
  routes?: Route[];
  /** Opt-in sample data (scripted arrivals + a demo route) for trying the app with no credentials. */
  demo?: boolean;
  /** Ticket type new route-monitored tickets inherit (the dashboard's top toggle). Per-ticket overridable. */
  defaultTicketType?: import("./eligibility.js").TicketType;
  /** TfL line ids the user commutes on (e.g. ["central","victoria"]) — watched for delay nudges. */
  tflLines?: string[];
  /** Optional free TfL Unified API app key (lifts the keyless rate limit). */
  tflAppKey?: string;
  scanDays: number;
}

export interface AppState {
  config: Config;
  tickets: Ticket[];
  /** Per-line date (YYYY-MM-DD) of the last TfL delay nudge, so a line is nudged once a day. */
  tflNotified?: Record<string, string>;
}

// Default to the easy path: watched routes, no automation to set up.
export const defaultState = (): AppState => ({
  config: { scanDays: 28 },
  tickets: [],
});

// Single encrypted state file holds both config (credentials) and ticket assets, satisfying
// the "ticket assets stored locally and encrypted" mandate with one passphrase.
export function load(path: string, passphrase: string): AppState {
  if (!existsSync(path)) return defaultState();
  const blob = JSON.parse(readFileSync(path, "utf8")) as SealedBlob;
  return open<AppState>(blob, passphrase);
}

export function save(path: string, passphrase: string, state: AppState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(seal(state, passphrase)), { mode: 0o600 });
}

/** Insert or replace a ticket by id, returning a new array (no in-place mutation). */
export function upsertTicket(tickets: Ticket[], ticket: Ticket): Ticket[] {
  const i = tickets.findIndex((t) => t.id === ticket.id);
  if (i === -1) return [...tickets, ticket];
  const next = tickets.slice();
  next[i] = ticket;
  return next;
}
