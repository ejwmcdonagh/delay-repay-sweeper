import { describe, it, expect } from "vitest";
import { tocName } from "./names.js";

describe("tocName", () => {
  it("gives the friendly name for an operator code", () => {
    expect(tocName("GW")).toBe("GWR");
  });

  it("returns the code unchanged when the operator is unknown", () => {
    expect(tocName("ZZ")).toBe("ZZ");
  });
});
