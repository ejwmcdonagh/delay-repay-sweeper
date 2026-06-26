import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Ticket } from "../types.js";

const portals: Record<string, string> = JSON.parse(
  readFileSync(fileURLToPath(new URL("../toc/portals.json", import.meta.url)), "utf8"),
);

import type { FieldSpec } from "./requirements.js";

// The journey facts we hand the user to paste into the portal. Personal/bank details aren't here —
// the user enters those on the TOC's own form, so the app never stores them.
export interface ClaimPayload {
  bookingRef: string;
  ticketNumber?: string; // paper tickets — not present in any email
  origin: string;
  destination: string;
  scheduledArrival: string;
  actualArrival: string;
  delayMinutes: number;
  pricePence: number;
  refundPence: number;
}

export interface ClaimResult {
  // needs-input = required proof is missing (e.g. a paper ticket number).
  status: "submitted" | "manual" | "failed" | "needs-input";
  portalUrl?: string;
  payload?: ClaimPayload;
  claimRef?: string;
  message?: string;
  missing?: FieldSpec[];
  accountRequired?: boolean;
}

export interface ClaimExecutor {
  submit(ticket: Ticket, payload: ClaimPayload, portalUrl: string): Promise<ClaimResult>;
}

// Fallback when the operating TOC is unknown (e.g. a watched route with no ticket).
const NATIONAL_RAIL = "https://www.nationalrail.co.uk/delay-repay/";

export function portalFor(toc: string): string | undefined {
  return portals[toc];
}

/** The portal to send the user to — the TOC's own, or National Rail's hub if the TOC is unknown. */
export function claimPortal(toc: string): string {
  return portals[toc] ?? NATIONAL_RAIL;
}

export function buildClaimPayload(ticket: Ticket): ClaimPayload {
  if (!ticket.assessment || !ticket.actualArrival) throw new Error("ticket has no validated delay");
  return {
    bookingRef: ticket.journey.bookingRef,
    origin: ticket.journey.origin,
    destination: ticket.journey.destination,
    scheduledArrival: ticket.journey.scheduledArrival,
    actualArrival: ticket.actualArrival,
    delayMinutes: ticket.assessment.delayMinutes,
    pricePence: ticket.journey.pricePence,
    refundPence: ticket.assessment.refundPence,
    ticketNumber: ticket.extras?.ticketNumber,
  };
}

// Default executor: never touches the TOC site automatically. It opens the correct portal and
// hands the user a ready-to-paste payload — safe against changing DOMs, captchas, and ToS.
export class ManualHelperExecutor implements ClaimExecutor {
  async submit(_ticket: Ticket, payload: ClaimPayload, portalUrl: string): Promise<ClaimResult> {
    return { status: "manual", portalUrl, payload };
  }
}
