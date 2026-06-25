import { describe, it, expect } from "vitest";
import { claimReadiness, accountRequired } from "./requirements.js";
import type { Ticket } from "../types.js";

const base: Ticket = {
  id: "t1",
  journey: { retailer: "avanti", bookingRef: "AB12CD", origin: "London Euston", destination: "Manchester Piccadilly", scheduledDeparture: "2026-06-24T14:30:00.000Z", scheduledArrival: "2026-06-24T16:38:00.000Z", pricePence: 4000, ticketType: "single" },
  destinationCrs: "MAN", toc: "AV", status: "eligible", pollAttempts: 1,
};

const identity = { name: "A Commuter", email: "a@b.com", address: "1 St", sortCode: "00-00-00", accountNumber: "12345678" };

describe("claimReadiness", () => {
  it("reports no missing fields for an eTicket with a complete profile", () => {
    expect(claimReadiness(base, identity).missing).toHaveLength(0);
  });

  it("requires the ticket number for a paper ticket (not present in any email)", () => {
    const paper = { ...base, extras: { ticketMedium: "paper" as const } };
    expect(claimReadiness(paper, identity).missing.map((f) => f.key)).toContain("ticketNumber");
  });

  it("stops requiring the ticket number once the user has supplied it", () => {
    const paper = { ...base, extras: { ticketMedium: "paper" as const, ticketNumber: "01234567890" } };
    expect(claimReadiness(paper, identity).missing.map((f) => f.key)).not.toContain("ticketNumber");
  });

  it("flags bank details missing when the profile has none", () => {
    expect(claimReadiness(base, { name: "A", email: "a@b.com", address: "1 St" }).missing.map((f) => f.key)).toContain("bankSortCode");
  });

  it("reports that Avanti requires an account login", () => {
    expect(claimReadiness(base, identity).accountRequired).toBe(true);
  });
});

describe("accountRequired", () => {
  it("is false for TOCs with an open claim form", () => {
    expect(accountRequired("GW")).toBe(false);
  });
});
