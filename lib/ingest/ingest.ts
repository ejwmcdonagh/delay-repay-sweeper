import { randomUUID } from "node:crypto";
import type { Journey, RawEmail } from "../parsers/types.js";
import type { Ticket } from "../types.js";
import { parseEmail } from "../parsers/registry.js";
import { toCrs } from "../stations.js";

// Direct-TOC retailers map straight to their operator code. Third-party retailers (Trainline)
// leave TOC blank here — the operating TOC of the delayed leg is resolved from live service
// data at validation time. ponytail: blank-TOC tickets fall back to the manual helper.
const RETAILER_TOC: Record<string, string> = {
  lner: "GR",
  gwr: "GW",
  avanti: "AV",
};

export function buildTicket(journey: Journey): Ticket {
  return {
    id: randomUUID(),
    journey,
    destinationCrs: toCrs(journey.destination) ?? "",
    toc: RETAILER_TOC[journey.retailer] ?? "",
    status: "awaiting-arrival",
    pollAttempts: 0,
  };
}

/** Parse a batch of fetched emails into tickets, silently skipping unrecognised mail. */
export function ingestEmails(emails: RawEmail[]): Ticket[] {
  const tickets: Ticket[] = [];
  for (const email of emails) {
    const journey = parseEmail(email);
    if (journey) tickets.push(buildTicket(journey));
  }
  return tickets;
}
