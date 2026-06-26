import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseDisruptions,
  withinTflControl,
  isRefundable,
  tflLineStatus,
  logDisruptions,
  readTflLog,
  runTflPoll,
  FakeTflStatusProvider,
  type LineStatus,
} from "./status.js";

const line = (id: string, name: string, severity: number, description: string, reason?: string): LineStatus => ({
  id,
  name,
  lineStatuses: [{ statusSeverity: severity, statusSeverityDescription: description, reason }],
});

describe("parseDisruptions", () => {
  it("skips lines running a good service", () => {
    const out = parseDisruptions([line("victoria", "Victoria", 10, "Good Service")]);
    expect(out).toEqual([]);
  });

  it("reports the worst status when a line carries several", () => {
    const central: LineStatus = {
      id: "central",
      name: "Central",
      lineStatuses: [
        { statusSeverity: 9, statusSeverityDescription: "Minor Delays" },
        { statusSeverity: 6, statusSeverityDescription: "Severe Delays" },
      ],
    };
    expect(parseDisruptions([central])[0].description).toBe("Severe Delays");
  });
});

describe("withinTflControl", () => {
  it("excludes a delay caused by the weather", () => {
    expect(withinTflControl("Severe delays due to adverse weather conditions")).toBe(false);
  });
});

describe("isRefundable", () => {
  it("flags severe delays from a faulty train", () => {
    const d = parseDisruptions([line("central", "Central", 6, "Severe Delays", "due to a faulty train")])[0];
    expect(isRefundable(d)).toBe(true);
  });

  it("ignores minor delays as below the 15-minute threshold", () => {
    const d = parseDisruptions([line("central", "Central", 9, "Minor Delays", "due to a faulty train")])[0];
    expect(isRefundable(d)).toBe(false);
  });
});

describe("tflLineStatus", () => {
  it("reports good service for a watched line that isn't disrupted", async () => {
    const provider = new FakeTflStatusProvider([line("victoria", "Victoria", 10, "Good Service")]);
    const out = await tflLineStatus(provider, ["victoria"]);
    expect(out[0].description).toBe("Good Service");
  });

  it("flags a watched line that's refundably disrupted", async () => {
    const provider = new FakeTflStatusProvider([line("central", "Central", 6, "Severe Delays", "faulty train")]);
    const out = await tflLineStatus(provider, ["central"]);
    expect(out[0].refundable).toBe(true);
  });
});

describe("disruption log", () => {
  it("collapses repeated same-day entries to the latest per line", () => {
    const path = join(mkdtempSync(join(tmpdir(), "tfl-")), "log.jsonl");
    const d = parseDisruptions([line("central", "Central", 6, "Severe Delays", "faulty train")]);
    logDisruptions(path, d, new Date("2026-06-26T08:00:00Z"));
    logDisruptions(path, d, new Date("2026-06-26T08:10:00Z"));
    expect(readTflLog(path, ["central"]).length).toBe(1);
  });
});

describe("runTflPoll", () => {
  it("nudges a watched line once then dedupes within the same day", async () => {
    const provider = new FakeTflStatusProvider([line("central", "Central", 6, "Severe Delays", "faulty train")]);
    const notified: Record<string, string> = {};
    const sent: string[] = [];
    const now = new Date("2026-06-26T08:30:00Z");
    await runTflPoll(provider, ["central"], notified, (msg) => sent.push(msg), undefined, now);
    await runTflPoll(provider, ["central"], notified, (msg) => sent.push(msg), undefined, now);
    expect(sent.length).toBe(1);
  });

  it("does not nudge a line the user isn't watching", async () => {
    const provider = new FakeTflStatusProvider([line("northern", "Northern", 6, "Severe Delays", "faulty train")]);
    const sent: string[] = [];
    await runTflPoll(provider, ["central"], {}, (msg) => sent.push(msg));
    expect(sent).toEqual([]);
  });
});
