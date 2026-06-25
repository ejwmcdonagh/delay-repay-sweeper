import { describe, it, expect } from "vitest";
import { scanSince, MAX_SCAN_DAYS } from "./window.js";

const now = new Date("2026-06-25T12:00:00Z");

describe("scanSince", () => {
  it("returns the date N days before now", () => {
    expect(scanSince(7, now).toISOString()).toBe("2026-06-18T12:00:00.000Z");
  });

  it("clamps to the 28-day Delay Repay limit", () => {
    expect(scanSince(60, now).toISOString()).toBe(scanSince(MAX_SCAN_DAYS, now).toISOString());
  });
});
