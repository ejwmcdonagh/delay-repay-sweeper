import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ClaimExecutor, ClaimPayload, ClaimResult } from "./executor.js";
import type { Ticket } from "../types.js";
import { solveWithCap, twoCaptchaSolveOnce } from "./captcha.js";

const fieldmap: Record<string, Record<string, string>> = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fieldmap.json", import.meta.url)), "utf8"),
);

// Autonomous executor. OPT-IN ONLY (config.autonomous) — automated submission and CAPTCHA
// circumvention may breach a TOC's terms, and portal DOMs change without notice. Playwright is a
// lazy dynamic import so it isn't a hard dependency for users who stay on the manual helper.
// ponytail: real fill logic, but the selectors in fieldmap.json are placeholders and this path is
// unverified against live portals — treat as the scaffold the PRD's "headless submission" needs,
// not a turnkey integration. Upgrade path: verify selectors per TOC, then widen fieldmap coverage.
export class PlaywrightExecutor implements ClaimExecutor {
  constructor(private readonly captchaApiKey?: string) {}

  async submit(ticket: Ticket, payload: ClaimPayload, portalUrl: string): Promise<ClaimResult> {
    const map = fieldmap[ticket.toc];
    if (!map) return { status: "failed", message: `no field map for TOC ${ticket.toc}` };

    let chromium: typeof import("playwright").chromium;
    try {
      ({ chromium } = await import("playwright"));
    } catch {
      return { status: "failed", message: "playwright not installed; run `npm i playwright` to enable autonomous mode" };
    }

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(portalUrl);
      await page.fill(map.bookingRef, payload.bookingRef);
      await page.fill(map.origin, payload.origin);
      await page.fill(map.destination, payload.destination);
      await page.fill(map.scheduledArrival, payload.scheduledArrival);
      await page.fill(map.delayMinutes, String(payload.delayMinutes));
      await page.fill(map.claimantName, payload.claimantName);
      await page.fill(map.claimantEmail, payload.claimantEmail);

      // Solve a reCAPTCHA if present, capped so a rogue page can't drain the solver balance.
      const sitekey = await page.getAttribute(".g-recaptcha", "data-sitekey").catch(() => null);
      if (sitekey && this.captchaApiKey) {
        const outcome = await solveWithCap(twoCaptchaSolveOnce(this.captchaApiKey, sitekey, portalUrl));
        if (outcome.exhausted) return { status: "failed", message: "captcha unsolved after 3 attempts", payload, portalUrl };
        await page.evaluate((tok) => {
          const el = document.querySelector<HTMLTextAreaElement>("#g-recaptcha-response");
          if (el) el.value = tok;
        }, outcome.token!);
      }

      await page.click(map.submit);
      return { status: "submitted", portalUrl, payload };
    } finally {
      await browser.close();
    }
  }
}
