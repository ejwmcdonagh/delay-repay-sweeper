import type { DelayAssessment, TicketType } from "./eligibility.js";
import type { TicketMedium } from "./claim/requirements.js";

// One watched-route journey. Origin/destination are station names; CRS resolution is a separate
// lookup (see PLAN.md). Synthesised by routeTicket from a Route the user defined — pricePence comes
// from the route's stored fare table.
export interface Journey {
  retailer: string;
  bookingRef: string;
  origin: string;
  destination: string;
  /** ISO 8601 timestamps. */
  scheduledDeparture: string;
  scheduledArrival: string;
  pricePence: number;
  ticketType: TicketType;
}

// Claim data the route monitor can't supply — declared by the user per ticket.
export interface TicketExtras {
  ticketMedium?: TicketMedium;
  ticketNumber?: string; // paper tickets
  smartcardRef?: string; // smartcard tickets
  proofImagePath?: string; // Oyster/contactless statement or season-ticket photo
}

export type TicketStatus =
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
  /** When the claim was submitted (ISO). Drives the "refunds requested this month" metric. */
  claimedAt?: string;
  pollAttempts: number;
  extras?: TicketExtras;
  /** Set once we've alerted the user this delay is claimable, so we notify only once. */
  notified?: boolean;
  /** Synthesised from a watched Route — fare comes from the route's table, claim is manual. */
  fromRoute?: boolean;
  /** The booked service was cancelled and a later train was taken; the delay is measured from the
   * cancelled service's scheduled arrival. Surfaced so the user knows why it counts. */
  cancelledConnection?: boolean;
}
