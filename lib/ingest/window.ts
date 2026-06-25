// Delay Repay claims expire 28 days after travel, so scanning never needs to look further back.
export const MAX_SCAN_DAYS = 28;

/** The earliest date (inclusive) an email should be fetched from, given a scan depth. */
export function scanSince(days: number, now: Date = new Date()): Date {
  const clamped = Math.min(Math.max(days, 1), MAX_SCAN_DAYS);
  return new Date(now.getTime() - clamped * 24 * 60 * 60 * 1000);
}
