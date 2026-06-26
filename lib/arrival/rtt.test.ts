import { describe, it, expect } from "vitest";
import { buildSearchUrl, parseArrival, parseServices } from "./rtt.js";

const scheduled = new Date("2026-06-24T16:38:00Z");

describe("buildSearchUrl", () => {
  it("targets the arrivals board for the CRS at the scheduled date and time", () => {
    expect(buildSearchUrl("MAN", scheduled)).toBe(
      "https://api.rtt.io/api/v1/json/search/MAN/2026/06/24/1638/arrivals",
    );
  });
});

describe("parseArrival", () => {
  const response = (realtimeArrival: string | undefined) => ({
    services: [{ locationDetail: { gbttBookedArrival: "1638", realtimeArrival } }],
  });

  it("returns the actual arrival time for the matching service", () => {
    expect(parseArrival(response("1700"), scheduled)?.toISOString()).toBe("2026-06-24T17:00:00.000Z");
  });

  it("returns null when the service has no real-time arrival yet", () => {
    expect(parseArrival(response(undefined), scheduled)).toBeNull();
  });

  it("returns null when no service matches the scheduled minute", () => {
    expect(parseArrival({ services: [] }, scheduled)).toBeNull();
  });
});

describe("parseServices", () => {
  const board = {
    services: [
      { locationDetail: { gbttBookedArrival: "0830", realtimeArrival: "0852" } }, // in window, 22 late
      { locationDetail: { gbttBookedArrival: "1030", realtimeArrival: "1031" } }, // outside window
    ],
  };
  const date = new Date("2026-06-24T00:00:00Z");

  it("returns only services whose booked arrival is inside the window", () => {
    const services = parseServices(board, date, "06:30", "10:00");
    expect(services).toHaveLength(1);
    expect(services[0].actualArrival?.toISOString()).toBe("2026-06-24T08:52:00.000Z");
  });

  it("carries the operating TOC from the service's atocCode", () => {
    const withToc = { services: [{ atocCode: "GW", locationDetail: { gbttBookedArrival: "0830", realtimeArrival: "0852" } }] };
    expect(parseServices(withToc, date, "06:30", "10:00")[0].toc).toBe("GW");
  });
});
