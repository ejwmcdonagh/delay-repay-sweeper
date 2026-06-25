// National Rail Historical Service Performance (HSP) API — the once-a-day batch fallback for
// arrivals the live provider never confirmed (PRD §3, "Batch Fallback"). HSP needs both ends of
// the journey, so it doesn't fit the per-ticket ArrivalProvider seam; it's its own backfiller.
// Data lags ~a day, which is exactly why it runs at 02:00 over the trailing 28 days.

const BASE = "https://hsp-prod.rockshore.net/api/v1";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function buildMetricsRequest(originCrs: string, destCrs: string, scheduled: Date) {
  const date = `${scheduled.getUTCFullYear()}-${pad(scheduled.getUTCMonth() + 1)}-${pad(scheduled.getUTCDate())}`;
  const hhmm = `${pad(scheduled.getUTCHours())}${pad(scheduled.getUTCMinutes())}`;
  return { from_loc: originCrs, to_loc: destCrs, from_time: hhmm, to_time: hhmm, from_date: date, to_date: date, days: "WEEKDAY" };
}

interface MetricsResponse {
  Services?: { serviceAttributesMetrics?: { rids?: string[] } }[] | null;
}
export function parseRids(json: MetricsResponse): string[] {
  return (json.Services ?? []).flatMap((s) => s.serviceAttributesMetrics?.rids ?? []);
}

interface DetailsResponse {
  serviceAttributesDetails?: { locations?: { location?: string; gbtt_pta?: string; actual_ta?: string }[] };
}
/** Actual arrival at the destination from a serviceDetails payload, or null if not reported. */
export function parseArrivalFromDetails(json: DetailsResponse, destCrs: string, scheduled: Date): Date | null {
  const loc = (json.serviceAttributesDetails?.locations ?? []).find((l) => l.location === destCrs);
  if (!loc?.actual_ta) return null;
  const arrived = new Date(scheduled);
  arrived.setUTCHours(Number(loc.actual_ta.slice(0, 2)), Number(loc.actual_ta.slice(3, 5)), 0, 0);
  if (arrived.getTime() < scheduled.getTime() - 12 * 3600_000) arrived.setUTCDate(arrived.getUTCDate() + 1);
  return arrived;
}

/** Milliseconds until the next occurrence of `hour` (UTC) — used to time the nightly sweep. */
export function msUntilNextRun(hour: number, now: Date = new Date()): number {
  const next = new Date(now);
  next.setUTCHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

export class HspBackfiller {
  constructor(private readonly user: string, private readonly password: string) {}

  private async post(path: string, body: unknown): Promise<any> {
    const auth = Buffer.from(`${this.user}:${this.password}`).toString("base64");
    const res = await fetch(`${BASE}/${path}`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HSP ${path} failed: ${res.status}`);
    return res.json();
  }

  async arrivalFor(originCrs: string, destCrs: string, scheduled: Date): Promise<Date | null> {
    const rids = parseRids(await this.post("serviceMetrics", buildMetricsRequest(originCrs, destCrs, scheduled)));
    if (!rids.length) return null;
    return parseArrivalFromDetails(await this.post("serviceDetails", { rid: rids[0] }), destCrs, scheduled);
  }
}
