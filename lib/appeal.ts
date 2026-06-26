import type { ClaimPayload } from "./claim/executor.js";

/**
 * Draft an appeal from the original claim payload plus the historical arrival proof we already
 * hold. Quotes the booked vs actual arrival so the TOC can't reject on a "no evidence" technicality.
 */
export function generateAppeal(payload: ClaimPayload, proof: string): string {
  return [
    `Re: Delay Repay appeal — booking ${payload.bookingRef}`,
    "",
    `I am appealing the rejection of my Delay Repay claim for ${payload.origin} to ${payload.destination}.`,
    `My service was booked to arrive at ${payload.scheduledArrival} but arrived at ${payload.actualArrival},`,
    `a delay of ${payload.delayMinutes} minutes — above the 15-minute threshold.`,
    "",
    `Independent arrival evidence: ${proof}`,
    "",
    `I therefore request the compensation due of £${(payload.refundPence / 100).toFixed(2)}.`,
    `Regards,`,
    payload.claimantName,
  ].join("\n");
}
