import type { ArrivalProvider, RouteService } from "./provider.js";

// Realtime Trains API. The two pure helpers (URL + response parsing) carry the tests;
// getActualArrival is the thin network shell around them.
// Docs: https://www.realtimetrains.co.uk/about/developer/pull/docs/

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function buildSearchUrl(crs: string, scheduled: Date): string {
  const y = scheduled.getUTCFullYear();
  const m = pad(scheduled.getUTCMonth() + 1);
  const d = pad(scheduled.getUTCDate());
  const hhmm = `${pad(scheduled.getUTCHours())}${pad(scheduled.getUTCMinutes())}`;
  // Arrivals board at the destination, so we read arrival times rather than departures.
  return `https://api.rtt.io/api/v1/json/search/${crs}/${y}/${m}/${d}/${hhmm}/arrivals`;
}

interface RttService {
  // atocCode is the operating TOC, carried at the service top level (e.g. "GW"). Without it every
  // watched-route ticket shows a blank operator.
  atocCode?: string;
  locationDetail?: { gbttBookedArrival?: string; realtimeArrival?: string; origin?: { crs?: string }[] };
}
interface RttResponse {
  services?: RttService[] | null;
}

/**
 * Find the service scheduled to arrive at `scheduled` and return its actual arrival time.
 * Matches on the booked arrival minute (HHMM) because that's the stable key across a board.
 * Returns null if the service isn't found or has no real-time arrival yet.
 */
export function parseArrival(json: RttResponse, scheduled: Date): Date | null {
  const wantHHmm = `${pad(scheduled.getUTCHours())}${pad(scheduled.getUTCMinutes())}`;
  const svc = (json.services ?? []).find((s) => s.locationDetail?.gbttBookedArrival === wantHHmm);
  const actual = svc?.locationDetail?.realtimeArrival;
  if (!actual) return null;

  const arrived = new Date(scheduled);
  arrived.setUTCHours(Number(actual.slice(0, 2)), Number(actual.slice(2, 4)), 0, 0);
  // Crossed midnight while delayed: realtime is an earlier clock time than booked.
  if (arrived.getTime() < scheduled.getTime() - 12 * 3600_000) arrived.setUTCDate(arrived.getUTCDate() + 1);
  return arrived;
}

function timeFrom(date: Date, hhmm: string): Date {
  const d = new Date(date);
  d.setUTCHours(Number(hhmm.slice(0, 2)), Number(hhmm.slice(3, 5)), 0, 0);
  return d;
}

/** Every service on the arrivals board whose booked arrival falls in [fromTime, toTime]. */
export function parseServices(json: RttResponse, date: Date, fromTime: string, toTime: string): RouteService[] {
  const out: RouteService[] = [];
  for (const s of json.services ?? []) {
    const booked = s.locationDetail?.gbttBookedArrival;
    if (!booked || booked < fromTime.replace(":", "") || booked > toTime.replace(":", "")) continue;
    const scheduledArrival = timeFrom(date, `${booked.slice(0, 2)}:${booked.slice(2, 4)}`);
    out.push({ scheduledArrival, actualArrival: parseArrival(json, scheduledArrival), toc: s.atocCode });
  }
  return out;
}

export class RttArrivalProvider implements ArrivalProvider {
  constructor(private readonly user: string, private readonly token: string) {}

  private async board(url: string): Promise<RttResponse> {
    const auth = Buffer.from(`${this.user}:${this.token}`).toString("base64");
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (!res.ok) throw new Error(`RTT request failed: ${res.status}`);
    return (await res.json()) as RttResponse;
  }

  async getActualArrival(destinationCrs: string, scheduled: Date): Promise<Date | null> {
    return parseArrival(await this.board(buildSearchUrl(destinationCrs, scheduled)), scheduled);
  }

  async servicesInWindow(destinationCrs: string, date: Date, fromTime: string, toTime: string): Promise<RouteService[]> {
    // ponytail: one board query anchored at the window start. RTT returns ~2h of services; for a
    // wider window, page from the last service's time. Fine for typical commute bands.
    const json = await this.board(buildSearchUrl(destinationCrs, timeFrom(date, fromTime)));
    return parseServices(json, date, fromTime, toTime);
  }
}
