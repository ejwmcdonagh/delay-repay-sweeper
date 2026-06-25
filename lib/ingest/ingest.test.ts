import { describe, it, expect } from "vitest";
import { buildTicket, ingestEmails } from "./ingest.js";
import type { Journey, RawEmail } from "../parsers/types.js";

const journey: Journey = {
  retailer: "lner",
  bookingRef: "ZZ99XY",
  origin: "London Kings Cross",
  destination: "Edinburgh",
  scheduledDeparture: "2026-06-25T10:00:00.000Z",
  scheduledArrival: "2026-06-25T14:20:00.000Z",
  pricePence: 12000,
  ticketType: "return",
};

describe("buildTicket", () => {
  it("resolves the destination CRS code", () => {
    expect(buildTicket(journey).destinationCrs).toBe("EDB");
  });

  it("maps a direct-TOC retailer to its operator code", () => {
    expect(buildTicket(journey).toc).toBe("GR");
  });

  it("starts a ticket awaiting arrival", () => {
    expect(buildTicket(journey).status).toBe("awaiting-arrival");
  });
});

describe("ingestEmails", () => {
  it("skips emails no parser recognises", () => {
    const spam: RawEmail = { from: "x@example.com", subject: "", body: "" };
    expect(ingestEmails([spam])).toHaveLength(0);
  });
});
