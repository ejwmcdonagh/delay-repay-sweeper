import { describe, it, expect } from "vitest";
import { mergeTickets, setExtras, confirmJourney, applyConfig, backfillRoutes, type Ctx } from "./app.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { ManualHelperExecutor } from "./claim/executor.js";
import { FakeArrivalProvider } from "./arrival/provider.js";
import { defaultState } from "./store.js";
import type { Ticket } from "./types.js";

const ticket = (ref: string): Ticket => ({
  id: ref,
  journey: { retailer: "x", bookingRef: ref, origin: "A", destination: "B", scheduledDeparture: "2026-06-24T08:00:00.000Z", scheduledArrival: "2026-06-24T09:00:00.000Z", pricePence: 4000, ticketType: "single" },
  destinationCrs: "B", toc: "AV", status: "awaiting-arrival", pollAttempts: 0,
});

describe("mergeTickets", () => {
  it("adds tickets with new booking references", () => {
    expect(mergeTickets([ticket("A")], [ticket("B")])).toHaveLength(2);
  });

  it("does not re-add a ticket already tracked by booking reference", () => {
    expect(mergeTickets([ticket("A")], [ticket("A")])).toHaveLength(1);
  });
});

describe("setExtras", () => {
  it("merges a supplied ticket number into the ticket", () => {
    const state = defaultState();
    state.tickets = [ticket("A")];
    const ctx: Ctx = {
      statePath: join(tmpdir(), `s-${randomBytes(4).toString("hex")}.json`),
      passphrase: "pw", state, provider: new FakeArrivalProvider(), executor: new ManualHelperExecutor(), demo: true,
    };
    setExtras(ctx, "A", { ticketNumber: "01234567890" });
    expect(ctx.state.tickets[0].extras?.ticketNumber).toBe("01234567890");
  });
});

describe("applyConfig", () => {
  it("leaves demo mode and rebuilds the provider the moment an RTT token is saved", () => {
    const live = new FakeArrivalProvider();
    const ctx: Ctx = {
      statePath: join(tmpdir(), `s-${randomBytes(4).toString("hex")}.json`), passphrase: "pw",
      state: defaultState(), provider: new FakeArrivalProvider(), executor: new ManualHelperExecutor(),
      demo: true, buildProvider: () => live,
    };
    applyConfig(ctx, { rtt: { token: "X" } });
    expect(ctx.demo).toBe(false);
    expect(ctx.provider).toBe(live);
  });

  it("drops the seeded demo route once a token is configured", () => {
    const ctx: Ctx = {
      statePath: join(tmpdir(), `s-${randomBytes(4).toString("hex")}.json`), passphrase: "pw",
      state: defaultState(), provider: new FakeArrivalProvider(), executor: new ManualHelperExecutor(),
      demo: true, buildProvider: () => new FakeArrivalProvider(),
    };
    ctx.state.config.routes = [{ id: "demo-route", label: "Morning commute", origin: "London Waterloo", destination: "Brighton", fromTime: "06:30", toTime: "10:00" }];
    applyConfig(ctx, { rtt: { token: "X" } });
    expect(ctx.state.config.routes).toHaveLength(0);
  });
});

describe("applyConfig demo toggle", () => {
  const ctxFor = (demo: boolean) => {
    const ctx: Ctx = {
      statePath: join(tmpdir(), `s-${randomBytes(4).toString("hex")}.json`), passphrase: "pw",
      state: defaultState(), provider: new FakeArrivalProvider(), executor: new ManualHelperExecutor(),
      demo, buildProvider: () => new FakeArrivalProvider(),
    };
    return ctx;
  };

  it("turns demo off when the flag is cleared", () => {
    const ctx = ctxFor(true);
    applyConfig(ctx, { demo: false });
    expect(ctx.demo).toBe(false);
  });

  it("seeds a sample route when demo is turned on", () => {
    const ctx = ctxFor(false);
    applyConfig(ctx, { demo: true });
    expect(ctx.state.config.routes).toHaveLength(1);
  });
});

describe("backfillRoutes", () => {
  // 2026-06-29 is a Monday; the trailing 28 days include Monday 2026-06-22 and Tuesday 2026-06-23.
  const NOW = new Date("2026-06-29T12:00:00Z");
  const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00Z`);

  function ctxWithBoard() {
    const ctx: Ctx = {
      statePath: join(tmpdir(), `s-${randomBytes(4).toString("hex")}.json`), passphrase: "pw",
      state: defaultState(), executor: new ManualHelperExecutor(), demo: false,
      provider: new FakeArrivalProvider({}, {
        BTN: [
          { scheduledArrival: at("2026-06-22", "08:30"), actualArrival: at("2026-06-22", "08:52") }, // Mon, 22 min late
          { scheduledArrival: at("2026-06-23", "08:30"), actualArrival: at("2026-06-23", "08:52") }, // Tue, 22 min late
        ],
      }),
    };
    // Mondays-only watched route into Brighton.
    ctx.state.config.routes = [{ id: "r1", label: "Commute", origin: "London Waterloo", destination: "Brighton", fromTime: "06:30", toTime: "10:00", days: [1] }];
    return ctx;
  }

  it("imports a delayed service from a scheduled day in the window", async () => {
    const ctx = ctxWithBoard();
    await backfillRoutes(ctx, 28, NOW);
    expect(ctx.state.tickets.filter((t) => t.status === "eligible")).toHaveLength(1);
  });

  it("skips a delay on a day the route does not run", async () => {
    const ctx = ctxWithBoard();
    await backfillRoutes(ctx, 28, NOW);
    expect(ctx.state.tickets.some((t) => t.journey.bookingRef.includes("2026-06-23"))).toBe(false);
  });

  it("marks imported delays as notified so a 28-day import fires no alerts", async () => {
    const ctx = ctxWithBoard();
    await backfillRoutes(ctx, 28, NOW);
    expect(ctx.state.tickets.every((t) => t.notified)).toBe(true);
  });
});

describe("confirmJourney", () => {
  const candidate = (hhmm: string): Ticket => ({
    ...ticket(`r1:2026-06-25:${hhmm}`),
    status: "awaiting-confirmation",
    fromRoute: true,
  });

  function ctxWith(tickets: Ticket[]): Ctx {
    const state = defaultState();
    state.tickets = tickets;
    return { statePath: join(tmpdir(), `s-${randomBytes(4).toString("hex")}.json`), passphrase: "pw", state, provider: new FakeArrivalProvider(), executor: new ManualHelperExecutor(), demo: true };
  }

  it("makes the chosen train claimable", () => {
    const ctx = ctxWith([candidate("08:30"), candidate("09:05")]);
    confirmJourney(ctx, ctx.state.tickets[0].id);
    expect(ctx.state.tickets.find((t) => t.id === ctx.state.tickets[0].id)?.status).toBe("eligible");
  });

  it("drops the other candidates for that route and day", () => {
    const ctx = ctxWith([candidate("08:30"), candidate("09:05")]);
    confirmJourney(ctx, ctx.state.tickets[0].id);
    expect(ctx.state.tickets).toHaveLength(1);
  });
});
