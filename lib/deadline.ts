import type { TicketStatus } from "./types.js";

export const CLAIM_WINDOW_DAYS = 28; // legal Delay Repay deadline
export const ALERT_DAY = 25; // alert with a 3-day buffer for manual intervention

export function daysSinceTravel(travelDate: Date, now: Date = new Date()): number {
  return Math.floor((now.getTime() - travelDate.getTime()) / (24 * 60 * 60 * 1000));
}

// A claim that's already submitted/claimed needs no nudge; everything else that's reached day 25
// and not yet expired gets one high-priority alert so it can't quietly miss the 28-day window.
export function needsDeadlineAlert(travelDate: Date, status: TicketStatus, now: Date = new Date()): boolean {
  if (status === "claimed" || status === "on-time") return false;
  const days = daysSinceTravel(travelDate, now);
  return days >= ALERT_DAY && days <= CLAIM_WINDOW_DAYS;
}
