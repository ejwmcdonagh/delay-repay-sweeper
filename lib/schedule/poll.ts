// Delay Repay is judged on arrival, not departure, so we never poll at departure time.
export const POLL_AFTER_MIN = 15;

/** First poll fires 15 minutes after the booked arrival — the earliest a 15-min delay is provable. */
export function firstPollAt(scheduledArrival: Date): Date {
  return new Date(scheduledArrival.getTime() + POLL_AFTER_MIN * 60_000);
}

/** Exponential backoff (15, 30, 60, ... min) while a train is still en route / data is missing. */
export function backoffMinutes(attempt: number): number {
  return POLL_AFTER_MIN * 2 ** Math.max(0, attempt - 1);
}

export function isDue(at: Date, now: Date = new Date()): boolean {
  return now.getTime() >= at.getTime();
}
