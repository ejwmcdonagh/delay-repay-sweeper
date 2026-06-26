import { describe, it, expect } from "vitest";
import { generateAppeal } from "./appeal.js";
import type { ClaimPayload } from "./claim/executor.js";

const payload: ClaimPayload = {
  bookingRef: "AB12CD", origin: "London Euston", destination: "Manchester Piccadilly",
  scheduledArrival: "2026-06-24T16:38:00.000Z", actualArrival: "2026-06-24T17:00:00.000Z",
  delayMinutes: 22, pricePence: 4000, refundPence: 1000,
};

describe("generateAppeal", () => {
  it("quotes the booking reference and delay in the appeal", () => {
    const text = generateAppeal(payload, "RTT log: arrived 17:00");
    expect(text).toContain("AB12CD");
    expect(text).toContain("22 minutes");
  });
});
