import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Ticket } from "../types.js";
import type { Config } from "../store.js";

const portals: Record<string, string> = JSON.parse(
  readFileSync(fileURLToPath(new URL("../toc/portals.json", import.meta.url)), "utf8"),
);

import type { FieldSpec } from "./requirements.js";

/** The exact data a Delay Repay form needs, reused for both copy-buttons and DOM auto-fill. */
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
  claimantName: string;
  claimantEmail: string;
  claimantAddress: string;
  claimantPhone: string;
  bankSortCode: string;
  bankAccountNumber: string;
}

export interface ClaimResult {
  // needs-input = required fields are missing (e.g. a paper ticket number or bank details).
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

export function buildClaimPayload(ticket: Ticket, identity: Config["identity"]): ClaimPayload {
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
    claimantName: identity?.name ?? "",
    claimantEmail: identity?.email ?? "",
    claimantAddress: identity?.address ?? "",
    claimantPhone: identity?.phone ?? "",
    bankSortCode: identity?.sortCode ?? "",
    bankAccountNumber: identity?.accountNumber ?? "",
  };
}

// Default executor: never touches the TOC site automatically. It opens the correct portal and
// hands the user a ready-to-paste payload — safe against changing DOMs, captchas, and ToS.
export class ManualHelperExecutor implements ClaimExecutor {
  async submit(_ticket: Ticket, payload: ClaimPayload, portalUrl: string): Promise<ClaimResult> {
    return { status: "manual", portalUrl, payload };
  }
}
