import { describe, it, expect } from "vitest";
import { detectRejection, generateAppeal } from "./appeal.js";
import type { ClaimPayload } from "./claim/executor.js";

const payload: ClaimPayload = {
  bookingRef: "AB12CD", origin: "London Euston", destination: "Manchester Piccadilly",
  scheduledArrival: "2026-06-24T16:38:00.000Z", actualArrival: "2026-06-24T17:00:00.000Z",
  delayMinutes: 22, pricePence: 4000, refundPence: 1000, claimantName: "A Commuter", claimantEmail: "a@b.com",
  claimantAddress: "1 St", claimantPhone: "07000 000000", bankSortCode: "00-00-00", bankAccountNumber: "12345678",
};

describe("detectRejection", () => {
  it("detects a rejection notice (TC-004)", () => {
    expect(detectRejection({ from: "x@av.co.uk", subject: "Your Delay Repay claim", body: "has been rejected." })).toBe(true);
  });

  it("does not flag a normal confirmation email", () => {
    expect(detectRejection({ from: "x@av.co.uk", subject: "Booking confirmed", body: "thanks" })).toBe(false);
  });
});

describe("generateAppeal", () => {
  it("quotes the booking reference and delay in the appeal", () => {
    const text = generateAppeal(payload, "RTT log: arrived 17:00");
    expect(text).toContain("AB12CD");
    expect(text).toContain("22 minutes");
  });
});
