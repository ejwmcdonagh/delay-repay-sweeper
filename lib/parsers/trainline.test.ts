import { describe, it, expect } from "vitest";
import { trainlineParser } from "./trainline.js";
import type { RawEmail } from "./types.js";

// Representative Trainline confirmation. We control both sides of this fixture;
// real-world variants get added as the fixture corpus grows (see PLAN.md, Ingestion).
const email: RawEmail = {
  from: "no-reply@info.thetrainline.com",
  subject: "Your booking is confirmed",
  body: [
    "Your booking is confirmed",
    "Booking reference: ABCD1234",
    "London Euston to Manchester Piccadilly",
    "Tue 24 Jun 2026, dep 14:30 arr 16:38",
    "Ticket type: Single",
    "Total: £45.50",
  ].join("\n"),
};

describe("trainlineParser", () => {
  it("matches emails sent from the Trainline domain", () => {
    expect(trainlineParser.matches(email)).toBe(true);
  });

  it("does not match an unrelated sender", () => {
    expect(trainlineParser.matches({ ...email, from: "tickets@lner.co.uk" })).toBe(false);
  });

  it("extracts the origin and destination", () => {
    const j = trainlineParser.parse(email);
    expect(j.origin).toBe("London Euston");
    expect(j.destination).toBe("Manchester Piccadilly");
  });

  it("extracts the price as integer pence", () => {
    const j = trainlineParser.parse(email);
    expect(j.pricePence).toBe(4550);
  });

  it("extracts the scheduled arrival as an ISO timestamp", () => {
    const j = trainlineParser.parse(email);
    expect(j.scheduledArrival).toBe("2026-06-24T16:38:00.000Z");
  });
});
