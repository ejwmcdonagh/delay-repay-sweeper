import { describe, it, expect } from "vitest";
import { firstPollAt, backoffMinutes, isDue } from "./poll.js";

describe("firstPollAt", () => {
  it("schedules the first poll 15 minutes after booked arrival", () => {
    expect(firstPollAt(new Date("2026-06-24T16:38:00Z")).toISOString()).toBe("2026-06-24T16:53:00.000Z");
  });
});

describe("backoffMinutes", () => {
  it("doubles the interval each attempt", () => {
    expect([backoffMinutes(1), backoffMinutes(2), backoffMinutes(3)]).toEqual([15, 30, 60]);
  });
});

describe("isDue", () => {
  it("is true once now has reached the scheduled poll time", () => {
    expect(isDue(new Date("2026-06-24T16:53:00Z"), new Date("2026-06-24T17:00:00Z"))).toBe(true);
  });
});
