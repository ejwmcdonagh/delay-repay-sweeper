import { describe, it, expect } from "vitest";
import { needsDeadlineAlert } from "./deadline.js";

const travel = new Date("2026-06-01T12:00:00Z");
const day25 = new Date("2026-06-26T12:00:00Z");

describe("needsDeadlineAlert", () => {
  it("alerts on an unsubmitted eligible claim at day 25 (TC-005)", () => {
    expect(needsDeadlineAlert(travel, "eligible", day25)).toBe(true);
  });

  it("does not alert on a claim already submitted", () => {
    expect(needsDeadlineAlert(travel, "claimed", day25)).toBe(false);
  });

  it("does not alert before day 25", () => {
    expect(needsDeadlineAlert(travel, "eligible", new Date("2026-06-20T12:00:00Z"))).toBe(false);
  });
});
