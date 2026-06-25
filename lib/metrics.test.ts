import { describe, it, expect } from "vitest";
import { computeMetrics } from "./metrics.js";
import type { Ticket } from "./types.js";

const now = new Date("2026-06-25T12:00:00Z");

const ticket = (status: Ticket["status"], refundPence: number, dep = "2026-06-10T08:00:00.000Z"): Ticket => ({
  id: Math.random().toString(36),
  journey: { retailer: "x", bookingRef: "r", origin: "A", destination: "B", scheduledDeparture: dep, scheduledArrival: dep, pricePence: 4000, ticketType: "single" },
  destinationCrs: "B", toc: "AV", status,
  assessment: { delayMinutes: 22, eligible: true, refundPence, band: "25%" },
  pollAttempts: 1,
});

describe("computeMetrics", () => {
  it("sums refunds from claimed tickets into total reclaimed", () => {
    expect(computeMetrics([ticket("claimed", 1500)], now).totalReclaimedPence).toBe(1500);
  });

  it("sums and counts eligible-but-unclaimed tickets as pending", () => {
    const m = computeMetrics([ticket("eligible", 1000), ticket("eligible", 2000)], now);
    expect(m.pendingEligiblePence).toBe(3000);
    expect(m.pendingEligibleCount).toBe(2);
  });

  it("counts only this month's tickets as scanned this month", () => {
    const m = computeMetrics([ticket("eligible", 1000, "2026-06-10T08:00:00.000Z"), ticket("eligible", 1000, "2026-04-10T08:00:00.000Z")], now);
    expect(m.scannedThisMonth).toBe(1);
  });
});
