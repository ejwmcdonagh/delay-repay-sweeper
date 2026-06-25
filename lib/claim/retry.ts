// Submission retries on transient TOC failures (502, timeout, maintenance) back off over a day,
// then stop — past that it's a real problem for the deadline enforcer, not a retry.
export const RETRY_HOURS = [1, 4, 24];

/** When to attempt the next submission, or null once the schedule is exhausted. */
export function nextRetryAt(attempt: number, from: Date = new Date()): Date | null {
  const hours = RETRY_HOURS[attempt];
  if (hours === undefined) return null;
  return new Date(from.getTime() + hours * 60 * 60 * 1000);
}
