import { describe, it, expect } from "vitest";
import { routeBookingRef, withinWindow, routeTicket, runsOn, type Route } from "./routes.js";

const route: Route = { id: "r1", label: "Commute", origin: "London Waterloo", destination: "Brighton", fromTime: "06:30", toTime: "10:00" };

describe("withinWindow", () => {
  it("includes a service scheduled inside the window", () => {
    expect(withinWindow(new Date("2026-06-25T08:30:00Z"), "06:30", "10:00")).toBe(true);
  });

  it("excludes a service scheduled after the window", () => {
    expect(withinWindow(new Date("2026-06-25T10:30:00Z"), "06:30", "10:00")).toBe(false);
  });
});

describe("routeBookingRef", () => {
  it("is stable per route, day and service time", () => {
    const t = new Date("2026-06-25T08:30:00Z");
    expect(routeBookingRef(route, t)).toBe("r1:2026-06-25:08:30");
  });
});

describe("runsOn", () => {
  it("runs every day when no schedule is set", () => {
    expect(runsOn(route, new Date("2026-06-28T08:00:00Z"))).toBe(true); // a Sunday
  });

  it("skips a day not in the weekly schedule", () => {
    // 2026-06-28 is a Sunday (day 0); schedule is weekdays Mon–Fri.
    expect(runsOn({ ...route, days: [1, 2, 3, 4, 5] }, new Date("2026-06-28T08:00:00Z"))).toBe(false);
  });
});

describe("routeTicket", () => {
  it("resolves the destination CRS and carries no fare", () => {
    const t = routeTicket(route, new Date("2026-06-25T08:30:00Z"));
    expect(t.destinationCrs).toBe("BTN");
    expect(t.journey.pricePence).toBe(0);
  });

  it("inherits the route's fare for the ticket type so refunds can be costed", () => {
    const t = routeTicket({ ...route, fares: { single: 1240 } }, new Date("2026-06-25T08:30:00Z"), "single");
    expect(t.journey.pricePence).toBe(1240);
  });
});
