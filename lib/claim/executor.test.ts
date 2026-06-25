import { describe, it, expect } from "vitest";
import { buildClaimPayload, portalFor, ManualHelperExecutor } from "./executor.js";
import type { Ticket } from "../types.js";

const ticket: Ticket = {
  id: "t1",
  journey: {
    retailer: "avanti", bookingRef: "AB12CD", origin: "London Euston", destination: "Manchester Piccadilly",
    scheduledDeparture: "2026-06-24T14:30:00.000Z", scheduledArrival: "2026-06-24T16:38:00.000Z",
    pricePence: 4000, ticketType: "single",
  },
  destinationCrs: "MAN", toc: "AV", status: "eligible",
  actualArrival: "2026-06-24T17:00:00.000Z",
  assessment: { delayMinutes: 22, eligible: true, refundPence: 1000, band: "25%" },
  pollAttempts: 1,
};

describe("portalFor", () => {
  it("returns the Delay Repay portal URL for a known TOC", () => {
    expect(portalFor("AV")).toContain("avantiwestcoast");
  });
});

describe("buildClaimPayload", () => {
  it("carries the delay and refund from the validated assessment", () => {
    const p = buildClaimPayload(ticket, { name: "A Commuter", email: "a@b.com", address: "1 St" });
    expect(p.delayMinutes).toBe(22);
    expect(p.refundPence).toBe(1000);
  });

  it("throws when the ticket has not been validated", () => {
    expect(() => buildClaimPayload({ ...ticket, assessment: undefined }, undefined)).toThrow();
  });
});

describe("ManualHelperExecutor", () => {
  it("returns a manual result without auto-submitting", async () => {
    const payload = buildClaimPayload(ticket, undefined);
    const result = await new ManualHelperExecutor().submit(ticket, payload, "https://portal");
    expect(result.status).toBe("manual");
  });
});
