import { describe, it, expect } from "vitest";
import { toCrs, stationNames } from "./stations.js";

describe("toCrs", () => {
  it("resolves a known station name to its CRS code", () => {
    expect(toCrs("Manchester Piccadilly")).toBe("MAN");
  });

  it("is case and whitespace tolerant", () => {
    expect(toCrs("  london euston ")).toBe("EUS");
  });

  it("returns null for an unknown station", () => {
    expect(toCrs("Hogsmeade")).toBeNull();
  });

  it("resolves a common short name the official dataset only lists in full", () => {
    expect(toCrs("Edinburgh")).toBe("EDB"); // dataset spells it "Edinburgh Waverley"
  });

  it("resolves a station only present in the full bundled dataset", () => {
    expect(toCrs("Aberdeen")).toBe("ABD"); // not in the old curated subset
  });

  it("passes a value that is already a CRS code straight through", () => {
    expect(toCrs("PAD")).toBe("PAD");
  });
});

describe("stationNames", () => {
  it("returns the known station names sorted alphabetically", () => {
    const names = stationNames();
    expect(names).toEqual([...names].sort());
  });
});
