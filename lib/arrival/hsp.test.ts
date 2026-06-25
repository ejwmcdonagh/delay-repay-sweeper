import { describe, it, expect } from "vitest";
import { buildMetricsRequest, parseRids, parseArrivalFromDetails, msUntilNextRun } from "./hsp.js";

const scheduled = new Date("2026-06-24T16:38:00Z");

describe("buildMetricsRequest", () => {
  it("queries both ends of the journey at the scheduled date and minute", () => {
    expect(buildMetricsRequest("EUS", "MAN", scheduled)).toMatchObject({ from_loc: "EUS", to_loc: "MAN", from_time: "1638", from_date: "2026-06-24" });
  });
});

describe("parseRids", () => {
  it("flattens RIDs out of the metrics response", () => {
    expect(parseRids({ Services: [{ serviceAttributesMetrics: { rids: ["202606241"] } }] })).toEqual(["202606241"]);
  });
});

describe("parseArrivalFromDetails", () => {
  it("reads the actual arrival at the destination location", () => {
    const json = { serviceAttributesDetails: { locations: [{ location: "MAN", gbtt_pta: "1638", actual_ta: "17:02" }] } };
    expect(parseArrivalFromDetails(json, "MAN", scheduled)?.toISOString()).toBe("2026-06-24T17:02:00.000Z");
  });

  it("returns null when the destination has no actual arrival", () => {
    expect(parseArrivalFromDetails({ serviceAttributesDetails: { locations: [{ location: "MAN", gbtt_pta: "1638" }] } }, "MAN", scheduled)).toBeNull();
  });
});

describe("msUntilNextRun", () => {
  it("counts the milliseconds to the next 02:00", () => {
    const now = new Date("2026-06-24T20:00:00Z");
    expect(msUntilNextRun(2, now)).toBe(6 * 60 * 60 * 1000);
  });
});
