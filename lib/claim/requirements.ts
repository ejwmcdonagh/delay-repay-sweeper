import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Ticket } from "../types.js";

const toc: Record<string, { accountRequired: boolean }> = JSON.parse(
  readFileSync(fileURLToPath(new URL("./requirements.json", import.meta.url)), "utf8"),
);

// How the ticket was held — drives what proof the portal demands. A booking-confirmation email
// is an eTicket; the others a user must declare, because the proof they need (a paper ticket
// NUMBER, a smartcard reference, an Oyster/contactless statement) never appears in that email.
export type TicketMedium = "eticket" | "paper" | "smartcard" | "oyster" | "contactless" | "season";

export interface FieldSpec {
  key: string;
  label: string;
  /** user = must be entered per-ticket; email = already parsed from the booking email. */
  source: "user" | "email";
}

// We no longer collect the claimant's identity or bank details — the user fills those in on the
// TOC's own portal. So the only thing that can still block a claim is proof of travel, which
// depends on how the ticket was held.
const PROOF: Record<TicketMedium, FieldSpec[]> = {
  eticket: [{ key: "bookingRef", label: "Booking reference", source: "email" }],
  paper: [{ key: "ticketNumber", label: "Ticket number (long number on the ticket)", source: "user" }],
  smartcard: [{ key: "smartcardRef", label: "Smartcard reference number", source: "user" }],
  oyster: [{ key: "proofImage", label: "Oyster journey statement (upload)", source: "user" }],
  contactless: [{ key: "proofImage", label: "Contactless journey statement (upload)", source: "user" }],
  season: [{ key: "proofImage", label: "Photo of season ticket (upload)", source: "user" }],
};

export function accountRequired(tocCode: string): boolean {
  return (toc[tocCode] ?? toc.default).accountRequired;
}

export function requiredFields(medium: TicketMedium): FieldSpec[] {
  return PROOF[medium];
}

function valueFor(key: string, ticket: Ticket): unknown {
  switch (key) {
    case "bookingRef": return ticket.journey.bookingRef;
    case "ticketNumber": return ticket.extras?.ticketNumber;
    case "smartcardRef": return ticket.extras?.smartcardRef;
    case "proofImage": return ticket.extras?.proofImagePath;
    default: return undefined;
  }
}

/**
 * What still blocks this claim: the proof fields the user must supply (not already in the booking
 * email) plus whether the TOC portal needs an account login. The claim flow surfaces these before
 * handing the user to the portal, so e.g. a paper ticket prompts for its ticket number.
 */
export function claimReadiness(ticket: Ticket): {
  missing: FieldSpec[];
  accountRequired: boolean;
} {
  const medium = ticket.extras?.ticketMedium ?? "eticket";
  const missing = requiredFields(medium)
    .filter((f) => f.source !== "email")
    .filter((f) => !valueFor(f.key, ticket));
  return { missing, accountRequired: accountRequired(ticket.toc) };
}
