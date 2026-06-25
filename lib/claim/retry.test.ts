import { describe, it, expect } from "vitest";
import { nextRetryAt } from "./retry.js";

const from = new Date("2026-06-24T12:00:00Z");

describe("nextRetryAt", () => {
  it("schedules the first retry one hour out", () => {
    expect(nextRetryAt(0, from)?.toISOString()).toBe("2026-06-24T13:00:00.000Z");
  });

  it("backs off to 24 hours by the third retry", () => {
    expect(nextRetryAt(2, from)?.toISOString()).toBe("2026-06-25T12:00:00.000Z");
  });

  it("returns null once the retry schedule is exhausted", () => {
    expect(nextRetryAt(3, from)).toBeNull();
  });
});
