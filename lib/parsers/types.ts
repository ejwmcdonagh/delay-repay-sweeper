import type { TicketType } from "../eligibility.js";

export interface RawEmail {
  from: string;
  subject: string;
  body: string;
}

export interface Journey {
  retailer: string;
  bookingRef: string;
  origin: string;
  destination: string;
  /** ISO 8601 timestamps. CRS resolution from station name is a separate lookup (see PLAN.md). */
  scheduledDeparture: string;
  scheduledArrival: string;
  pricePence: number;
  ticketType: TicketType;
}

// Every retailer/TOC parser implements this. The registry tries each parser's `matches`
// in turn, so adding UK coverage means adding a module, never editing a central switch.
export interface TicketParser {
  id: string;
  matches(email: RawEmail): boolean;
  parse(email: RawEmail): Journey;
}
