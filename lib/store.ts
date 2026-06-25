import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { seal, open, type SealedBlob } from "./vault.js";
import type { Ticket } from "./types.js";

import type { OAuthProvider } from "./ingest/oauth.js";
import type { Route } from "./routes.js";

export interface EmailConfig {
  user: string;
  host: string;
  port: number;
  /** Password auth (IMAP app password) or OAuth2 (managed Gmail / M365). */
  password?: string;
  oauth?: { provider: OAuthProvider; clientId: string; refreshToken: string; accessToken?: string; expiry?: string };
}

// notify  = alert only; user claims manually via the portal link.
// manual  = alert + side-by-side copy helper (default).
// auto    = alert + autonomous headless filing (advanced, opt-in).
export type Mode = "notify" | "manual" | "auto";

export interface Config {
  email?: EmailConfig;
  // Next Gen RTT: just `token` (long-life token from api-portal.rtt.io). Old api.rtt.io basic auth
  // (deprecated, retires 30 Sep 2026) also supplies `user`.
  rtt?: { token: string; user?: string; baseUrl?: string };
  hsp?: { user: string; password: string };
  // Identity is injected into TOC claim forms. Lives in the encrypted state only.
  identity?: { name: string; email: string; address: string; phone?: string; sortCode?: string; accountNumber?: string };
  captcha?: { provider: "2captcha"; apiKey: string };
  /** Watched journeys (season-ticket / no-email monitoring). */
  routes?: Route[];
  /** Opt-in sample data (scripted arrivals + sample inbox) for trying the app with no credentials. */
  demo?: boolean;
  scanDays: number;
  mode: Mode;
}

export interface AppState {
  config: Config;
  tickets: Ticket[];
}

// Default to the easy path: notify-only, watched routes, no email/automation to set up.
export const defaultState = (): AppState => ({
  config: { scanDays: 28, mode: "notify" },
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
