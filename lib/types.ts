import type { Journey } from "./parsers/types.js";
import type { DelayAssessment } from "./eligibility.js";
import type { TicketMedium } from "./claim/requirements.js";

export type { Journey };

// Claim data that an email can't supply — declared by the user per ticket.
export interface TicketExtras {
  ticketMedium?: TicketMedium;
  ticketNumber?: string; // paper tickets
  smartcardRef?: string; // smartcard tickets
  proofImagePath?: string; // Oyster/contactless statement or season-ticket photo
}

export type TicketStatus =
  | "scanned" // parsed from email, awaiting its journey
  | "awaiting-arrival" // scheduled, will be polled at arrival+15
  | "on-time" // polled, arrived < 15 min late
  | "eligible" // delay >= 15 min, claim can be filed
  | "awaiting-confirmation" // watched route with confirm on: user must pick which train they took
  | "claimed" // claim submitted
  | "rejected" // TOC rejected; may be appealed
  | "action-required"; // automation gave up, user must intervene

export interface Ticket {
  id: string;
  journey: Journey;
  /** CRS resolved from the journey's destination station name. */
  destinationCrs: string;
  /** Operating TOC code for the delayed leg, used to pick the Delay Repay portal. */
  toc: string;
  status: TicketStatus;
  actualArrival?: string; // ISO, once known
  assessment?: DelayAssessment;
  claimRef?: string;
  pollAttempts: number;
  extras?: TicketExtras;
  /** Set once we've alerted the user this delay is claimable, so we notify only once. */
  notified?: boolean;
  /** Synthesised from a watched Route rather than a parsed email — no fare, manual claim. */
  fromRoute?: boolean;
}
