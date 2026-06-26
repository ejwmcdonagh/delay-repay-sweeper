/**
 * Single seam over every train-data source (Realtime Trains, Network Rail Darwin/HSP).
 * The validation engine only ever sees these methods, so swapping or combining providers never
 * touches eligibility logic. RTT is wired first (see PLAN.md, Validation).
 */
export interface RouteService {
  scheduledArrival: Date;
  actualArrival: Date | null;
  /** Operating TOC code, when the data source provides it (lets route claims pick the right portal). */
  toc?: string;
  /** Originating station CRS, when known — lets a watched route drop arrivals from other origins. */
  originCrs?: string;
  /** This scheduled service was cancelled — no actualArrival, but the gap still causes a delay if a
   * later service is taken instead. */
  cancelled?: boolean;
}

export interface ArrivalProvider {
  /**
   * Actual arrival time at the destination CRS for the service scheduled to arrive at `scheduled`.
   * Returns null when the data isn't available yet (train still en route, or HSP not yet published).
   */
  getActualArrival(destinationCrs: string, scheduled: Date): Promise<Date | null>;

  /**
   * Every service arriving at `destinationCrs` on `date` within the [fromTime, toTime] window —
   * the basis for watched-route ("season ticket") monitoring. Optional: providers that can't list
   * a board (e.g. a single-service lookup) simply omit it.
   */
  servicesInWindow?(destinationCrs: string, date: Date, fromTime: string, toTime: string): Promise<RouteService[]>;
}

const within = (d: Date, from: string, to: string) => {
  const hhmm = d.toISOString().slice(11, 16);
  return hhmm >= from && hhmm <= to;
};

/** Deterministic provider for tests and offline development. */
export class FakeArrivalProvider implements ArrivalProvider {
  constructor(
    private readonly arrivals: Record<string, Date | null> = {},
    /** Scripted boards keyed by CRS, for servicesInWindow. */
    private readonly boards: Record<string, RouteService[]> = {},
  ) {}

  async getActualArrival(destinationCrs: string, scheduled: Date): Promise<Date | null> {
    // ponytail: keyed by "CRS@scheduledISO" — enough to script test scenarios; no fuzzy matching.
    const key = `${destinationCrs}@${scheduled.toISOString()}`;
    return key in this.arrivals ? this.arrivals[key] : null;
  }

  async servicesInWindow(destinationCrs: string, date: Date, fromTime: string, toTime: string): Promise<RouteService[]> {
    const day = date.toISOString().slice(0, 10);
    return (this.boards[destinationCrs] ?? []).filter(
      (s) => s.scheduledArrival.toISOString().slice(0, 10) === day && within(s.scheduledArrival, fromTime, toTime),
    );
  }
}
