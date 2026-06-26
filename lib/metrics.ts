import type { Ticket } from "./types.js";

export interface Metrics {
  totalReclaimedPence: number;
  pendingEligiblePence: number;
  pendingEligibleCount: number;
  /** Claims submitted to a TOC this month (status "claimed", dated by claimedAt). Replaces the old,
   * misleading "scanned this month", which counted by journey date and climbed on auto-created tickets. */
  refundsRequested: number;
}

const sameMonth = (iso: string, now: Date) => {
  const d = new Date(iso);
  return d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth();
};

/** Dashboard top-line numbers. Money stays in pence; the UI formats to pounds. */
export function computeMetrics(tickets: Ticket[], now: Date = new Date()): Metrics {
  let totalReclaimedPence = 0;
  let pendingEligiblePence = 0;
  let pendingEligibleCount = 0;
  let refundsRequested = 0;

  for (const t of tickets) {
    if (t.status === "claimed") {
      totalReclaimedPence += t.assessment?.refundPence ?? 0;
      // Count toward "this month" only when we know the claim date and it falls in the current month.
      if (t.claimedAt && sameMonth(t.claimedAt, now)) refundsRequested++;
    }
    if (t.status === "eligible") {
      pendingEligiblePence += t.assessment?.refundPence ?? 0;
      pendingEligibleCount++;
    }
  }

  return { totalReclaimedPence, pendingEligiblePence, pendingEligibleCount, refundsRequested };
}
