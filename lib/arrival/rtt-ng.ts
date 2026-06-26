import type { ArrivalProvider, RouteService } from "./provider.js";

// Realtime Trains "Next Generation" API (https://data.rtt.io). Auth is a long-life token exchanged
// for a short (~20 min) access token at /api/get_access_token, then sent as a Bearer on each call.
// Endpoint: GET /gb-nr/location?code=CRS&timeFrom=ISO&timeTo=ISO. The two pure parsers carry the
// tests; the class is the network + token-cache shell.
// (Replaces the old api.rtt.io basic-auth client, which shuts down 30 Sep 2026.)
const DEFAULT_BASE = "https://data.rtt.io";

interface NgArrival {
  scheduleAdvertised?: string;
  realtimeForecast?: string;
  isCancelled?: boolean;
}
interface NgService {
  temporalData?: { arrival?: NgArrival };
  scheduleMetadata?: { operator?: { code?: string } };
  // Originating station, so a watched route can drop arrivals from other origins. ponytail: field
  // name assumed for the NG schema like the rest of this client — verify against live data.
  locationDetail?: { origin?: { crs?: string }[] };
}
export interface NgResponse {
  services?: NgService[] | null;
}

// RTT returns naive local datetimes (no offset). We pin them to UTC so scheduled vs actual deltas
// — and HH:mm window matching — are consistent regardless of the host machine's timezone.
function parseNaive(s: string): Date {
  return new Date(/[Z+]|-\d\d:\d\d$/.test(s.slice(11)) ? s : `${s}Z`);
}

const hhmm = (d: Date) => d.toISOString().slice(11, 16);

export function buildLocationUrl(base: string, crs: string, fromIso: string, toIso: string): string {
  const p = new URLSearchParams({ code: crs, timeFrom: fromIso, timeTo: toIso });
  return `${base}/gb-nr/location?${p}`;
}

/** Map a location line-up into arrival services; a cancelled train counts as "not arrived". */
export function parseNgServices(json: NgResponse): RouteService[] {
  const out: RouteService[] = [];
  for (const s of json.services ?? []) {
    const a = s.temporalData?.arrival;
    if (!a?.scheduleAdvertised) continue;
    out.push({
      scheduledArrival: parseNaive(a.scheduleAdvertised),
      actualArrival: a.isCancelled || !a.realtimeForecast ? null : parseNaive(a.realtimeForecast),
      toc: s.scheduleMetadata?.operator?.code,
      originCrs: s.locationDetail?.origin?.[0]?.crs,
      cancelled: !!a.isCancelled,
    });
  }
  return out;
}

function naiveIso(date: Date, hhmmStr: string): string {
  // Send a naive (offset-less) datetime so RTT applies the station's local time, matching the
  // clock time the user means by "06:30".
  return `${date.toISOString().slice(0, 10)}T${hhmmStr}:00`;
}

const within = (t: string, from: string, to: string) => t >= from && t <= to;

export class RttNgArrivalProvider implements ArrivalProvider {
  private accessToken?: string;
  private validUntilMs = 0;

  constructor(private readonly refreshToken: string, private readonly base = DEFAULT_BASE) {}

  private async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.validUntilMs - 60_000) return this.accessToken;
    const res = await fetch(`${this.base}/api/get_access_token`, { headers: { Authorization: `Bearer ${this.refreshToken}` } });
    if (!res.ok) throw new Error(`RTT token request failed: ${res.status}`);
    const j = (await res.json()) as { token: string; validUntil: string };
    this.accessToken = j.token;
    this.validUntilMs = new Date(j.validUntil).getTime();
    return this.accessToken;
  }

  private async getLocation(crs: string, fromIso: string, toIso: string): Promise<NgResponse> {
    const res = await fetch(buildLocationUrl(this.base, crs, fromIso, toIso), {
      headers: { Authorization: `Bearer ${await this.token()}` },
    });
    if (res.status === 204) return { services: [] }; // valid query, no services
    if (!res.ok) throw new Error(`RTT request failed: ${res.status}`);
    return (await res.json()) as NgResponse;
  }

  async getActualArrival(destinationCrs: string, scheduled: Date): Promise<Date | null> {
    const from = naiveIso(scheduled, hhmm(new Date(scheduled.getTime() - 10 * 60_000)));
    const to = naiveIso(scheduled, hhmm(new Date(scheduled.getTime() + 40 * 60_000)));
    const services = parseNgServices(await this.getLocation(destinationCrs, from, to));
    return services.find((s) => hhmm(s.scheduledArrival) === hhmm(scheduled))?.actualArrival ?? null;
  }

  async servicesInWindow(destinationCrs: string, date: Date, fromTime: string, toTime: string): Promise<RouteService[]> {
    const json = await this.getLocation(destinationCrs, naiveIso(date, fromTime), naiveIso(date, toTime));
    return parseNgServices(json).filter((s) => within(hhmm(s.scheduledArrival), fromTime, toTime));
  }
}
