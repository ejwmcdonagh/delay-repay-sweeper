import { describe, it, expect } from "vitest";
import { parseEmail } from "./registry.js";
import type { RawEmail } from "./types.js";

const receipt = (from: string): RawEmail => ({
  from,
  subject: "Your booking is confirmed",
  body: [
    "Booking reference: ZZ99XY",
    "London Kings Cross to Edinburgh",
    "Wed 25 Jun 2026, dep 10:00 arr 14:20",
    "Ticket type: Return",
    "Total: £120.00",
  ].join("\n"),
});

describe("parseEmail", () => {
  it("routes an LNER receipt to the LNER parser", () => {
    expect(parseEmail(receipt("tickets@lner.co.uk"))?.retailer).toBe("lner");
  });

  it("routes a GWR receipt to the GWR parser", () => {
    expect(parseEmail(receipt("noreply@gwr.com"))?.retailer).toBe("gwr");
  });

  it("returns null when no parser recognises the sender", () => {
    expect(parseEmail(receipt("spam@example.com"))).toBeNull();
  });

  it("extracts return-ticket fields from a direct-TOC receipt", () => {
    const j = parseEmail(receipt("tickets@lner.co.uk"));
    expect(j?.ticketType).toBe("return");
    expect(j?.pricePence).toBe(12000);
  });
});
