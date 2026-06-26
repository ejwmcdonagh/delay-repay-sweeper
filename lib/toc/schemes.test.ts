import { describe, it, expect } from "vitest";
import { assessDelay } from "../eligibility.js";
import { schemeForToc } from "./schemes.js";

const sched = new Date("2026-06-24T16:38:00Z");
const arr = (mins: number) => new Date(sched.getTime() + mins * 60_000);

describe("schemeForToc", () => {
  it("applies Delay Repay 30 for LNER (not eligible at 20 minutes)", () => {
    const r = assessDelay({ scheduledArrival: sched, actualArrival: arr(20), pricePence: 4000, ticketType: "single", scheme: schemeForToc("GR") });
    expect(r.eligible).toBe(false);
  });

  it("defaults to Delay Repay 15 for an operator not in the table", () => {
    const r = assessDelay({ scheduledArrival: sched, actualArrival: arr(15), pricePence: 4000, ticketType: "single", scheme: schemeForToc("ZZ") });
    expect(r.eligible).toBe(true);
  });

  it("refunds the single fare for an Elizabeth line delay of 30 minutes", () => {
    const r = assessDelay({ scheduledArrival: sched, actualArrival: arr(30), pricePence: 4000, ticketType: "single", scheme: schemeForToc("XR") });
    expect(r.refundPence).toBe(4000);
  });
});
