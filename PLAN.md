# Delay Repay Sweeper — Implementation Plan

> **Email ingestion removed (2026-06-26).** The IMAP/OAuth inbox-reading path and the per-TOC
> email parsers never worked reliably; watched routes are simpler and are now the only ticket
> source. The checkboxes below that mention email/IMAP/OAuth/parsers describe deleted code
> (`lib/ingest/`, `lib/parsers/`) and are kept only as historical record.

Maps the Master PRD onto buildable phases. **The app runs end-to-end** (`npm start`). Logic is
test-driven — pure logic in `lib/`. The acceptance tests below (TC-xxx) are each pinned to a unit test.

Remaining work is hardening, not net-new architecture: verified Playwright selectors per portal,
marked with a `ponytail:` comment at its upgrade point in the code.

## Decisions (from kickoff)

| Question | Decision |
|----------|----------|
| Stack | Node/TS daemon + localhost React UI |
| Train data API | Both Darwin/HSP + RTT behind one `ArrivalProvider`; wire RTT first |
| Claim filing MVP | Full autonomous headless + BYOK CAPTCHA |
| This session | Scaffold + plan + first TDD slice |

### ⚠️ Risk note — autonomous filing
Headless DOM submission + CAPTCHA-solver bypass against 24+ TOC portals is the most fragile
and legally exposed part of the system (portal DOMs change without notice; automated
submission and CAPTCHA circumvention may breach each TOC's terms of use). It is deliberately
sequenced **last**, behind the data core and the side-by-side helper, so the app is useful and
correct even before — or if ever — full automation is enabled. Keep a manual "side-by-side
helper" fallback (webview + one-click copy) wired to the same `portals.json`.

---

## Phase 0 — Data core ✅ (this session)
PRD §3 (validation math), §2 (parsing).
- [x] `assessDelay` — Delay Repay tiers, integer-pence money.
- [x] `TicketParser` interface + registry + Trainline parser.
- [x] `ArrivalProvider` seam + `FakeArrivalProvider`.
- [x] `portals.json` TOC→portal registry.

## Phase 1 — Ingestion ✅
PRD §2.
- [x] IMAP client, app-password auth (`lib/ingest/imap.ts`); scan-depth window 7–28 days (`window.ts`).
- [x] Modular parser registry + Trainline/LNER/GWR/Avanti parsers (`lib/parsers/`).
- [x] Station-name → CRS lookup, pluggable full-CORPUS override + code passthrough (`lib/stations.ts`).
- [x] OAuth for managed Gmail / M365 (BYO client ID, PKCE loopback, XOAUTH2) — `lib/ingest/oauth.ts`.
- [ ] Still open: ship the full CRS dataset file; real per-TOC email fixtures (need real sample emails).

## Phase 2 — Validation engine ✅
PRD §3.
- [x] Pluggable `ArrivalProvider`; RTT **Next Gen** (`data.rtt.io`, token auth) `lib/arrival/rtt-ng.ts`
      — verified against live data; legacy basic-auth `lib/arrival/rtt.ts` kept until that API retires.
- [x] Arrival rule + poll-at-arrival+15 + exponential backoff + poll cap (`validate.ts`, `schedule/poll.ts`).
- [x] Nightly 02:00 HSP batch backfill for unresolved arrivals (`lib/arrival/hsp.ts`, daemon timer).
- [x] Watched-route / season-ticket window sweeper — no email required (`lib/routes.ts`, `servicesInWindow`).
- [x] Confirmation pool (opt-in per route): groups a window's delays and asks which train was boarded
      before treating it as a claim (`Route.confirm`, `confirmJourney`, status `awaiting-confirmation`).

## Phase 3 — Vault, daemon & UI ✅
PRD §1, §6.
- [x] AES-256-GCM vault, scrypt-derived key (`lib/vault.ts`); single encrypted state file (`store.ts`).
- [x] OS-keychain master key via native CLI, env/dev fallback (`lib/keychain.ts`).
- [x] Background daemon, 5-min sweep timer, localhost API (`lib/daemon/`, `server.ts`).
- [x] Dashboard: metric cards, ticket table, status badges, settings, OAuth connect, claim helper (`ui/`).
- [x] Operating modes notify / manual / auto, switchable live (`store.ts`, `app.ts`).
- [ ] Still open: start-on-login service scripts (launchd / Task Scheduler / systemd unit).

## Phase 4 — Execution engine ✅
PRD §4.
- [x] Manual side-by-side helper executor (safe default) + claim modal with copy buttons.
- [x] **Per-TOC claim requirements**: prompts for fields not in email (paper ticket number, smartcard
      ref, bank details) and flags account-login TOCs (`lib/claim/requirements.ts`, grounded in real portals).
- [x] Autonomous Playwright executor, opt-in, field-map driven (`lib/claim/playwright.ts`).
- [x] BYOK 2Captcha client with **hard 3-attempt cap** (`captcha.ts`); retry backoff 1h/4h/24h (`retry.ts`).
- [ ] Still open (not verifiable here): confirm selectors against each live portal; season-ticket
      confirmation-loop notification.

## Phase 5 — Edge cases & max value ✅
PRD §5.
- [x] Rejection detection + appeal generator (`lib/appeal.ts`).
- [x] 28-day deadline enforcer, alert at day 25 (`lib/deadline.ts`).

---

## Acceptance test coverage map
| TC | Scenario | Verified by |
|----|----------|-------------|
| TC-001 | Train recovers time, on-time arrival → no claim | `validate.test.ts` |
| TC-002 | 3 failed CAPTCHAs → pause, no solver drain | `claim/captcha.test.ts` |
| TC-003 | Retailer/TOC receipt parsed into the vault | `parsers/registry.test.ts`, `ingest/ingest.test.ts` |
| TC-004 | Rejection → appeal drafted | `appeal.test.ts` |
| TC-005 | Day-25 stuck claim → alert | `deadline.test.ts` |
| TC-006 | Multi-delay → eligibility + fractional refund math | `eligibility.test.ts`, `validate.test.ts` |

> TC-003/TC-006 note: the email-format and season-ticket *confirmation-loop* flows are wired in
> `lib/app.ts` but their live paths (real IMAP, push-notification round-trip) need credentials/UX
> work to fully exercise end-to-end; the logic they depend on is unit-covered above.
