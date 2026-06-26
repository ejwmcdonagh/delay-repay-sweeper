import { DR15, type Scheme } from "../eligibility.js";

// Operators on the older Delay Repay 30 scheme: nothing below 30 minutes, then 50% / 100% / full
// return, exactly like DR15 but without the 15-minute band. Verified per operator (2026-06-26):
// LNER (GR), CrossCountry (XC) and ScotRail (SR) all state a 30-minute minimum.
const DR30: Scheme = {
  tiers: [
    { minMinutes: 30, legFraction: 0.5 },
    { minMinutes: 60, legFraction: 1 },
  ],
  fullReturnMinutes: 120,
};

// TfL service delay refund (Tube / DLR / pay-as-you-go Overground & Elizabeth line): refunds the
// single pay-as-you-go fare once a journey runs 15+ minutes late — no percentage banding and no
// return escalation. Claim within 28 days. Modelled as a single 100% tier at 15 minutes.
// (https://tfl.gov.uk/fares/refunds-and-replacements/tube-and-dlr-delays)
const TFL: Scheme = {
  tiers: [{ minMinutes: 15, legFraction: 1 }],
  fullReturnMinutes: null,
};

// TOC code -> scheme. Anything unlisted falls back to DR15, the national default and most common.
const BY_TOC: Record<string, Scheme> = {
  GR: DR30, // LNER
  XC: DR30, // CrossCountry
  SR: DR30, // ScotRail
  TFL: TFL, // TfL service delay refund
  XR: TFL, // "XR" is the Elizabeth line's National Rail operator code in live arrival data — same TfL scheme
};

/** The Delay Repay scheme for an operating TOC code, defaulting to national Delay Repay 15. */
export function schemeForToc(toc: string): Scheme {
  return BY_TOC[toc] ?? DR15;
}
