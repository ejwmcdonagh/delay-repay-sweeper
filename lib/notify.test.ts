import { describe, it, expect } from "vitest";
import { formatSuccess } from "./notify.js";

describe("formatSuccess", () => {
  it("formats a claimed refund in the PRD's notification style", () => {
    expect(formatSuccess(1450, "Avanti")).toBe("Success: £14.50 claimed from Avanti");
  });
});
