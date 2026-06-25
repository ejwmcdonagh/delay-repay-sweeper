import type { Ticket } from "./types.js";

export interface Metrics {
  totalReclaimedPence: number;
  pendingEligiblePence: number;
  pendingEligibleCount: number;
  scannedThisMonth: number;
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
  let scannedThisMonth = 0;

  for (const t of tickets) {
    if (t.status === "claimed") totalReclaimedPence += t.assessment?.refundPence ?? 0;
    if (t.status === "eligible") {
      pendingEligiblePence += t.assessment?.refundPence ?? 0;
      pendingEligibleCount++;
    }
    if (sameMonth(t.journey.scheduledDeparture, now)) scannedThisMonth++;
  }

  return { totalReclaimedPence, pendingEligiblePence, pendingEligibleCount, scannedThisMonth };
}
