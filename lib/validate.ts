import { assessDelay } from "./eligibility.js";
import { schemeForToc } from "./toc/schemes.js";
import type { ArrivalProvider } from "./arrival/provider.js";
import type { Ticket } from "./types.js";

// Stop polling after this many misses and hand off to the user, so a train that never reports
// (cancelled feed, bad CRS) can't poll forever.
export const MAX_POLLS = 6;

/**
 * Poll the arrival provider once for a ticket and return its updated state. The whole eligibility
 * decision keys off arrival at the destination CRS — a train that lost time at departure but
 * recovered en route resolves to "on-time" here (TC-001), avoiding a false claim.
 */
export async function validateTicket(
  ticket: Ticket,
  provider: ArrivalProvider,
  now: Date = new Date(),
): Promise<Ticket> {
  const scheduled = new Date(ticket.journey.scheduledArrival);
  const actual = await provider.getActualArrival(ticket.destinationCrs, scheduled);
  const pollAttempts = ticket.pollAttempts + 1;

  if (!actual) {
    return { ...ticket, pollAttempts, status: pollAttempts >= MAX_POLLS ? "action-required" : "awaiting-arrival" };
  }

  const assessment = assessDelay({
    scheduledArrival: scheduled,
    actualArrival: actual,
    pricePence: ticket.journey.pricePence,
    ticketType: ticket.journey.ticketType,
    scheme: schemeForToc(ticket.toc),
  });

  return {
    ...ticket,
    pollAttempts,
    actualArrival: actual.toISOString(),
    assessment,
    status: assessment.eligible ? "eligible" : "on-time",
  };
}
