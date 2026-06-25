import { describe, it, expect } from "vitest";
import { validateTicket, MAX_POLLS } from "./validate.js";
import { FakeArrivalProvider } from "./arrival/provider.js";
import type { Ticket } from "./types.js";

const ticket: Ticket = {
  id: "t1",
  journey: {
    retailer: "avanti",
    bookingRef: "AB12CD",
    origin: "London Euston",
    destination: "Manchester Piccadilly",
    scheduledDeparture: "2026-06-24T14:30:00.000Z",
    scheduledArrival: "2026-06-24T16:38:00.000Z",
    pricePence: 4000,
    ticketType: "single",
  },
  destinationCrs: "MAN",
  toc: "AV",
  status: "awaiting-arrival",
  pollAttempts: 0,
};

const arrivingAt = (iso: string) =>
  new FakeArrivalProvider({ [`MAN@2026-06-24T16:38:00.000Z`]: new Date(iso) });

describe("validateTicket", () => {
  it("marks an eligible claim when the train arrives 22 minutes late", async () => {
    const result = await validateTicket(ticket, arrivingAt("2026-06-24T17:00:00Z"));
    expect(result.status).toBe("eligible");
  });

  it("marks on-time when the train recovered lost time and arrived on schedule (TC-001)", async () => {
    const result = await validateTicket(ticket, arrivingAt("2026-06-24T16:38:00Z"));
    expect(result.status).toBe("on-time");
  });

  it("keeps awaiting arrival while the train has not yet reported", async () => {
    const result = await validateTicket(ticket, new FakeArrivalProvider());
    expect(result.status).toBe("awaiting-arrival");
  });

  it("escalates to action-required after the poll cap is reached", async () => {
    const result = await validateTicket({ ...ticket, pollAttempts: MAX_POLLS - 1 }, new FakeArrivalProvider());
    expect(result.status).toBe("action-required");
  });
});
