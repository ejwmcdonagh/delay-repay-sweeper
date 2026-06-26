/**
 * TfL line-status nudge. The Tube and DLR have no per-journey timetable (they run on frequency,
 * not named services with scheduled arrivals), so the scheduled-vs-actual ArrivalProvider model
 * can't measure a Tube delay — and TfL assesses the actual refund from your own Oyster/contactless
 * taps, which the API won't expose. So this is deliberately *not* an ArrivalProvider: it watches
 * the line-status feed and, when a line the user commutes on is badly disrupted for a reason within
 * TfL's control, nudges them to check whether they're owed a single-fare refund (claimed manually
 * through their TfL account). A softer signal than National Rail — it can't see your individual taps.
 */
import { appendFileSync, readFileSync, existsSync } from "node:fs";

const BASE = "https://api.tfl.gov.uk";
const REFUND_FORM = "https://tfl.gov.uk/fares/refunds/apply-for-a-service-delay-refund";

export interface LineStatus {
  id: string; // "central"
  name: string; // "Central"
  lineStatuses?: { statusSeverity: number; statusSeverityDescription: string; reason?: string }[];
}

export interface TflDisruption {
  id: string;
  line: string; // display name
  severity: number; // TfL severity: 10 = Good Service, lower = worse
  description: string; // e.g. "Severe Delays"
  reason?: string;
}

/** Worst (lowest-severity) non-good status per line. A line in good service produces nothing. */
export function parseDisruptions(lines: LineStatus[]): TflDisruption[] {
  const out: TflDisruption[] = [];
  for (const line of lines) {
    const worst = (line.lineStatuses ?? [])
      .filter((s) => s.statusSeverity < 10) // 10 = Good Service
      .sort((a, b) => a.statusSeverity - b.statusSeverity)[0];
    if (!worst) continue;
    out.push({ id: line.id, line: line.name, severity: worst.statusSeverity, description: worst.statusSeverityDescription, reason: worst.reason });
  }
  return out;
}

// Causes TfL won't refund for — outside their control (weather, planned works, security, customer
// incidents). ponytail: substring heuristic on the free-text reason — this is a nudge, not an
// adjudication, so a false positive just prompts the user to check their account, no harm done.
const EXCLUDED = [/weather/, /planned/, /engineering work/, /security alert/, /police/, /customer/, /taken ill/, /ill person/, /trespass/, /person on the track/, /fatality/];

export function withinTflControl(reason = ""): boolean {
  const r = reason.toLowerCase();
  return !EXCLUDED.some((re) => re.test(r));
}

// Severe Delays (6) or worse is where a 15-minute journey delay — TfL's refund threshold — is
// plausible; Minor Delays (9) and the like rarely reach it, so we don't nudge on them and spam.
const REFUNDABLE_SEVERITY = 6;

export function isRefundable(d: TflDisruption): boolean {
  return d.severity <= REFUNDABLE_SEVERITY && withinTflControl(d.reason);
}

export function nudgeMessage(lineName: string): string {
  return `${lineName} had major delays today — if your journey ran 15+ min late you may be owed a single fare. Claim within 28 days: ${REFUND_FORM}`;
}

export interface TflStatusProvider {
  /** Current line statuses for the given TfL modes (e.g. "tube", "dlr"). */
  status(modes: string[]): Promise<LineStatus[]>;
}

export class TflApi implements TflStatusProvider {
  // The Unified API is keyless (rate-limited); a free app key lifts the limit. No OAuth.
  constructor(private readonly appKey?: string) {}
  async status(modes: string[]): Promise<LineStatus[]> {
    const q = this.appKey ? `?app_key=${this.appKey}` : "";
    const res = await fetch(`${BASE}/Line/Mode/${modes.join(",")}/Status${q}`);
    if (!res.ok) throw new Error(`TfL status ${res.status}`);
    return res.json() as Promise<LineStatus[]>;
  }
}

export class FakeTflStatusProvider implements TflStatusProvider {
  constructor(private readonly lines: LineStatus[]) {}
  async status(): Promise<LineStatus[]> {
    return this.lines;
  }
}

export interface TflLineState {
  id: string;
  name: string;
  severity: number;
  description: string;
  refundable: boolean;
}

/** Live status for every watched line — good service included — so the dashboard shows them all. */
export async function tflLineStatus(provider: TflStatusProvider, watchedLineIds: string[]): Promise<TflLineState[]> {
  if (!watchedLineIds.length) return [];
  const lines = await provider.status(["tube", "dlr"]);
  const disrupted = new Map(parseDisruptions(lines).map((d) => [d.id, d]));
  return lines
    .filter((l) => watchedLineIds.includes(l.id))
    .map((l) => {
      const d = disrupted.get(l.id);
      // No disruption entry = good service (severity 10), which is the happy path most of the time.
      return d
        ? { id: l.id, name: l.name, severity: d.severity, description: d.description, refundable: isRefundable(d) }
        : { id: l.id, name: l.name, severity: 10, description: "Good Service", refundable: false };
    });
}

export interface TflLogEntry {
  ts: string;
  id: string;
  line: string;
  description: string;
  refundable: boolean;
}

// TfL serves no historical line status, so we build our own: append today's disruptions to a local
// JSONL file every poll. Writes are dumb (append-only); readTflLog collapses the duplicates a
// 10-minute poll produces. ponytail: append-only file, collapse on read; rotate only if it ever grows.
export function logDisruptions(path: string, disruptions: TflDisruption[], now: Date = new Date()): void {
  const ts = now.toISOString();
  for (const d of disruptions) {
    const entry: TflLogEntry = { ts, id: d.id, line: d.line, description: d.description, refundable: isRefundable(d) };
    appendFileSync(path, JSON.stringify(entry) + "\n");
  }
}

/** Disruption history for the watched lines, one entry per line per day (latest of that day wins),
 * newest first. */
export function readTflLog(path: string, watchedLineIds: string[]): TflLogEntry[] {
  if (!existsSync(path)) return [];
  const byDayLine = new Map<string, TflLogEntry>();
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    if (!raw) continue;
    const e = JSON.parse(raw) as TflLogEntry;
    if (!watchedLineIds.includes(e.id)) continue;
    byDayLine.set(`${e.ts.slice(0, 10)}:${e.id}`, e); // keep the last reading of each day
  }
  return [...byDayLine.values()].sort((a, b) => b.ts.localeCompare(a.ts));
}

/**
 * One poll: fetch watched-line status, log any disruptions (we build our own history), and fire a
 * once-per-day refund nudge per refundably-disrupted line. Mutates `notified` (lineId -> YYYY-MM-DD)
 * so a line isn't nudged twice in a day. Safe to call on a timer.
 */
export async function runTflPoll(
  provider: TflStatusProvider,
  watchedLineIds: string[],
  notified: Record<string, string>,
  notify: (message: string) => void,
  logPath?: string,
  now: Date = new Date(),
): Promise<void> {
  if (!watchedLineIds.length) return;
  const lines = await provider.status(["tube", "dlr"]);
  const disruptions = parseDisruptions(lines).filter((d) => watchedLineIds.includes(d.id));
  if (logPath) logDisruptions(logPath, disruptions, now);
  const today = now.toISOString().slice(0, 10);
  for (const d of disruptions) {
    if (!isRefundable(d) || notified[d.id] === today) continue;
    notify(nudgeMessage(d.line));
    notified[d.id] = today;
  }
}
