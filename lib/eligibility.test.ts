import { describe, it, expect } from "vitest";
import { assessDelay } from "./eligibility.js";

// Times are built off a fixed scheduled arrival to keep arithmetic obvious.
const sched = new Date("2026-06-24T16:38:00Z");
const arr = (mins: number) => new Date(sched.getTime() + mins * 60_000);

describe("assessDelay", () => {
  it("is not eligible when the train arrives on time", () => {
    const r = assessDelay({ scheduledArrival: sched, actualArrival: arr(0), pricePence: 4550, ticketType: "single" });
    expect(r.eligible).toBe(false);
  });

  it("is not eligible at 14 minutes (below the 15-minute threshold)", () => {
    const r = assessDelay({ scheduledArrival: sched, actualArrival: arr(14), pricePence: 4550, ticketType: "single" });
    expect(r.eligible).toBe(false);
  });

  it("pays 25% of a single fare for a 15-minute delay", () => {
    const r = assessDelay({ scheduledArrival: sched, actualArrival: arr(15), pricePence: 4000, ticketType: "single" });
    expect(r.refundPence).toBe(1000);
  });

  it("pays 50% of a single fare for a 30-minute delay", () => {
    const r = assessDelay({ scheduledArrival: sched, actualArrival: arr(30), pricePence: 4000, ticketType: "single" });
    expect(r.refundPence).toBe(2000);
  });

  it("is eligible at 15 minutes even when the fare is unknown (route monitoring)", () => {
    const r = assessDelay({ scheduledArrival: sched, actualArrival: arr(15), pricePence: 0, ticketType: "single" });
    expect(r.eligible).toBe(true);
  });

  it("pays 100% of a single fare for a 60-minute delay", () => {
    const r = assessDelay({ scheduledArrival: sched, actualArrival: arr(60), pricePence: 4000, ticketType: "single" });
    expect(r.refundPence).toBe(4000);
  });

  it("pays 25% of the per-leg fare for a return ticket delayed 15 minutes", () => {
    const r = assessDelay({ scheduledArrival: sched, actualArrival: arr(15), pricePence: 8000, ticketType: "return" });
    expect(r.refundPence).toBe(1000);
  });

  it("pays the full return fare when a return ticket is delayed 120 minutes", () => {
    const r = assessDelay({ scheduledArrival: sched, actualArrival: arr(120), pricePence: 8000, ticketType: "return" });
    expect(r.refundPence).toBe(8000);
  });

  it("reaches the 50% band for a season ticket delayed 30 minutes", () => {
    const r = assessDelay({ scheduledArrival: sched, actualArrival: arr(30), pricePence: 0, ticketType: "season" });
    expect(r.band).toBe("50%");
  });

  it("puts no amount on a season ticket (daily-equivalent fare is unknown)", () => {
    const r = assessDelay({ scheduledArrival: sched, actualArrival: arr(60), pricePence: 0, ticketType: "season" });
    expect(r.refundPence).toBe(0);
  });

  it("reaches the 100% band for a travelcard delayed 60 minutes", () => {
    const r = assessDelay({ scheduledArrival: sched, actualArrival: arr(60), pricePence: 0, ticketType: "travelcard" });
    expect(r.band).toBe("100%");
  });

  it("costs a season ticket off the per-journey fare once one is supplied", () => {
    // 60 min => 100% band; a season's per-journey (daily-equivalent) fare is banded like a single leg.
    const r = assessDelay({ scheduledArrival: sched, actualArrival: arr(60), pricePence: 1000, ticketType: "season" });
    expect(r.refundPence).toBe(1000);
  });

  // A Delay Repay 30 operator (e.g. LNER, CrossCountry, ScotRail) pays nothing below 30 minutes.
  const dr30 = { tiers: [{ minMinutes: 30, legFraction: 0.5 }, { minMinutes: 60, legFraction: 1 }], fullReturnMinutes: 120 };

  it("is not eligible at 20 minutes under a Delay Repay 30 scheme", () => {
    const r = assessDelay({ scheduledArrival: sched, actualArrival: arr(20), pricePence: 4000, ticketType: "single", scheme: dr30 });
    expect(r.eligible).toBe(false);
  });

  it("pays 50% at 30 minutes under a Delay Repay 30 scheme", () => {
    const r = assessDelay({ scheduledArrival: sched, actualArrival: arr(30), pricePence: 4000, ticketType: "single", scheme: dr30 });
    expect(r.refundPence).toBe(2000);
  });
});
