import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Ticket } from "../types.js";
import type { Config } from "../store.js";

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
  /** identity = from the saved profile; user = must be entered per-ticket; email = already parsed. */
  source: "identity" | "user" | "email";
}

// Every claim needs the claimant's contact + payout details; proof depends on the medium.
const BASE: FieldSpec[] = [
  { key: "claimantName", label: "Full name", source: "identity" },
  { key: "claimantEmail", label: "Email", source: "identity" },
  { key: "claimantAddress", label: "Postal address", source: "identity" },
  { key: "bankSortCode", label: "Bank sort code", source: "identity" },
  { key: "bankAccountNumber", label: "Bank account number", source: "identity" },
];

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
  return [...BASE, ...PROOF[medium]];
}

function valueFor(key: string, ticket: Ticket, identity: Config["identity"]): unknown {
  switch (key) {
    case "claimantName": return identity?.name;
    case "claimantEmail": return identity?.email;
    case "claimantAddress": return identity?.address;
    case "bankSortCode": return identity?.sortCode;
    case "bankAccountNumber": return identity?.accountNumber;
    case "bookingRef": return ticket.journey.bookingRef;
    case "ticketNumber": return ticket.extras?.ticketNumber;
    case "smartcardRef": return ticket.extras?.smartcardRef;
    case "proofImage": return ticket.extras?.proofImagePath;
    default: return undefined;
  }
}

/**
 * What still blocks this claim: the fields the user must supply (not already in the email or
 * profile) plus whether the TOC portal needs an account login. The claim flow surfaces these
 * before attempting submission, so e.g. a paper ticket prompts for its ticket number.
 */
export function claimReadiness(ticket: Ticket, identity: Config["identity"]): {
  missing: FieldSpec[];
  accountRequired: boolean;
} {
  const medium = ticket.extras?.ticketMedium ?? "eticket";
  const missing = requiredFields(medium)
    .filter((f) => f.source !== "email")
    .filter((f) => !valueFor(f.key, ticket, identity));
  return { missing, accountRequired: accountRequired(ticket.toc) };
}
