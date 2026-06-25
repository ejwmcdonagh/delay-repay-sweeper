export type TicketType = "single" | "return";

export interface DelayInput {
  scheduledArrival: Date;
  actualArrival: Date;
  /** Whole-ticket price in pence. Money is integer pence to avoid float rounding bugs on the payout path. */
  pricePence: number;
  ticketType: TicketType;
}

export interface DelayAssessment {
  delayMinutes: number;
  eligible: boolean;
  refundPence: number;
  /** Banding that was applied, for display and audit. */
  band: "none" | "25%" | "50%" | "100%" | "100%-return";
}

// Standard national Delay Repay scheme. A return ticket is treated as two equal legs,
// so the per-leg fare is half the ticket; the 120-minute band uniquely pays the whole return.
// ponytail: hard-coded national tiers; some TOCs run enhanced schemes (e.g. 100% at 30 min).
// Upgrade path: pass a per-TOC tier table in DelayInput when those parsers land.
export function assessDelay(input: DelayInput): DelayAssessment {
  const delayMs = input.actualArrival.getTime() - input.scheduledArrival.getTime();
  const delayMinutes = Math.floor(delayMs / 60_000);

  const legFare = input.ticketType === "return" ? Math.round(input.pricePence / 2) : input.pricePence;

  let refundPence = 0;
  let band: DelayAssessment["band"] = "none";

  if (delayMinutes >= 120 && input.ticketType === "return") {
    refundPence = input.pricePence;
    band = "100%-return";
  } else if (delayMinutes >= 60) {
    refundPence = legFare;
    band = "100%";
  } else if (delayMinutes >= 30) {
    refundPence = Math.round(legFare * 0.5);
    band = "50%";
  } else if (delayMinutes >= 15) {
    refundPence = Math.round(legFare * 0.25);
    band = "25%";
  }

  // Eligibility is the 15-minute legal threshold, independent of whether we know the fare — a
  // route-monitored journey (season ticket / no ticket) is eligible with an as-yet-unknown refund.
  return { delayMinutes, eligible: delayMinutes >= 15, refundPence, band };
}
