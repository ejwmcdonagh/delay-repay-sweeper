import { describe, it, expect } from "vitest";
import { buildLocationUrl, parseNgServices } from "./rtt-ng.js";

// Shape captured from a live data.rtt.io /gb-nr/location response.
const response = {
  services: [
    { temporalData: { arrival: { scheduleAdvertised: "2026-06-25T08:30:00", realtimeForecast: "2026-06-25T08:52:00", isCancelled: false } }, scheduleMetadata: { operator: { code: "SN" } } },
    { temporalData: { arrival: { scheduleAdvertised: "2026-06-25T09:00:00", isCancelled: true } }, scheduleMetadata: { operator: { code: "SN" } } },
  ],
};

describe("buildLocationUrl", () => {
  it("queries the gb-nr location endpoint with the CRS and time window", () => {
    const url = new URL(buildLocationUrl("https://data.rtt.io", "BTN", "2026-06-25T06:30:00", "2026-06-25T10:00:00"));
    expect(url.pathname).toBe("/gb-nr/location");
    expect(url.searchParams.get("code")).toBe("BTN");
    expect(url.searchParams.get("timeFrom")).toBe("2026-06-25T06:30:00");
  });
});

describe("parseNgServices", () => {
  it("reads scheduled and realtime arrival from a service", () => {
    const s = parseNgServices(response)[0];
    expect(s.scheduledArrival.toISOString()).toBe("2026-06-25T08:30:00.000Z");
    expect(s.actualArrival?.toISOString()).toBe("2026-06-25T08:52:00.000Z");
  });

  it("captures the operating TOC code", () => {
    expect(parseNgServices(response)[0].toc).toBe("SN");
  });

  it("treats a cancelled train as not arrived", () => {
    expect(parseNgServices(response)[1].actualArrival).toBeNull();
  });

  it("flags a cancelled train as cancelled", () => {
    expect(parseNgServices(response)[1].cancelled).toBe(true);
  });
});
