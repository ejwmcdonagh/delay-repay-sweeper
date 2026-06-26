export type TicketType = "single" | "return" | "travelcard" | "multi" | "season";

/** One band of a Delay Repay scheme: at >= `minMinutes` late, pay `legFraction` of the per-leg fare. */
export interface Tier {
  minMinutes: number;
  legFraction: number;
}

/**
 * A train operator's Delay Repay scheme. `tiers` ascend by threshold; `fullReturnMinutes` is the
 * delay at which a return ticket pays the WHOLE return (the national 120-min rule), or null for
 * schemes without that escalation (e.g. TfL pay-as-you-go).
 */
export interface Scheme {
  tiers: Tier[];
  fullReturnMinutes: number | null;
}

// National Delay Repay 15 — the default and most common scheme. Per-operator schemes (DR30, TfL)
// live in toc/schemes.ts and are passed in via DelayInput.scheme.
export const DR15: Scheme = {
  tiers: [
    { minMinutes: 15, legFraction: 0.25 },
    { minMinutes: 30, legFraction: 0.5 },
    { minMinutes: 60, legFraction: 1 },
  ],
  fullReturnMinutes: 120,
};

export interface DelayInput {
  scheduledArrival: Date;
  actualArrival: Date;
  /** Whole-ticket price in pence. Money is integer pence to avoid float rounding bugs on the payout path. */
  pricePence: number;
  ticketType: TicketType;
  /** The operating TOC's scheme; defaults to national Delay Repay 15 when not supplied. */
  scheme?: Scheme;
}

export interface DelayAssessment {
  delayMinutes: number;
  eligible: boolean;
  refundPence: number;
  /** Banding that was applied, for display and audit. */
  band: "none" | "25%" | "50%" | "100%" | "100%-return";
}

// Map a tier's per-leg fraction to a display band. The 120-min full-return case is handled separately.
const bandFor = (legFraction: number): DelayAssessment["band"] =>
  legFraction >= 1 ? "100%" : legFraction >= 0.5 ? "50%" : "25%";

// A return ticket is treated as two equal legs, so the per-leg fare is half the ticket; a scheme's
// full-return threshold uniquely pays the whole return. Bands and thresholds come from the operator's
// scheme (default DR15) so a Delay Repay 30 operator isn't paid below its own 30-minute floor.
export function assessDelay(input: DelayInput): DelayAssessment {
  const scheme = input.scheme ?? DR15;
  const delayMs = input.actualArrival.getTime() - input.scheduledArrival.getTime();
  const delayMinutes = Math.floor(delayMs / 60_000);

  // Highest tier whose threshold the delay reaches; none => below the scheme's floor => not eligible.
  const tier = [...scheme.tiers].reverse().find((t) => delayMinutes >= t.minMinutes);
  if (!tier) return { delayMinutes, eligible: false, refundPence: 0, band: "none" };

  const fullReturn =
    input.ticketType === "return" && scheme.fullReturnMinutes !== null && delayMinutes >= scheme.fullReturnMinutes;
  const band: DelayAssessment["band"] = fullReturn ? "100%-return" : bandFor(tier.legFraction);

  // A return splits into two equal legs (per-leg fare = half the ticket) and uniquely pays the whole
  // return at the full-return threshold. Single/travelcard/multi/season are banded off the per-journey
  // fare as supplied. With no fare on file (pricePence 0) we surface the band and leave the £ at 0.
  let refundPence = 0;
  if (input.pricePence > 0) {
    const legFare = input.ticketType === "return" ? Math.round(input.pricePence / 2) : input.pricePence;
    refundPence = fullReturn ? input.pricePence : Math.round(legFare * tier.legFraction);
  }

  // Eligible once any tier is met, independent of whether we know the fare — a route-monitored
  // journey (season ticket / no ticket) is eligible with an as-yet-unknown refund.
  return { delayMinutes, eligible: true, refundPence, band };
}
