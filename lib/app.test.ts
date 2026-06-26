import { describe, it, expect } from "vitest";
import { dedupeRouteTickets, setExtras, setTicketDetails, removeTicket, claim, markFiled, sweep, view, confirmJourney, applyConfig, backfillRoutes, addRoute, setRouteFares, type Ctx } from "./app.js";
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

const ctxFor = (state = defaultState()): Ctx => ({
  statePath: join(tmpdir(), `s-${randomBytes(4).toString("hex")}.json`),
  passphrase: "pw", state, provider: new FakeArrivalProvider(), executor: new ManualHelperExecutor(), demo: true,
});

describe("setTicketDetails", () => {
  it("corrects the operating TOC the user picked the wrong train for", () => {
    const ctx = ctxFor();
    ctx.state.tickets = [{ ...ticket("A"), fromRoute: true, toc: "XR" }];
    setTicketDetails(ctx, "A", { toc: "GW" });
    expect(ctx.state.tickets[0].toc).toBe("GW");
  });

  it("re-bands the refund when the ticket type changes", () => {
    const ctx = ctxFor();
    // 120-min delayed route ticket: as a single it tops out at the 100% band, as a return at 100%-return.
    const t = ticket("A");
    t.journey = { ...t.journey, ticketType: "single", scheduledArrival: "2026-06-24T09:00:00.000Z" };
    ctx.state.tickets = [{ ...t, fromRoute: true, status: "eligible", actualArrival: "2026-06-24T11:00:00.000Z" }];
    setTicketDetails(ctx, "A", { ticketType: "return" });
    expect(ctx.state.tickets[0].assessment?.band).toBe("100%-return");
  });
});

describe("view portal gating", () => {
  it("exposes a portal URL for an operator with a verified Delay Repay page", () => {
    const ctx = ctxFor();
    ctx.state.tickets = [{ ...ticket("A"), toc: "GW" }];
    expect(view(ctx).tickets[0].portalUrl).toBeTruthy();
  });

  it("leaves the portal URL unset for an unsupported operator (so the claim button is hidden)", () => {
    const ctx = ctxFor();
    ctx.state.tickets = [{ ...ticket("A"), toc: "ZZ" }];
    expect(view(ctx).tickets[0].portalUrl).toBeUndefined();
  });
});

describe("dedupeRouteTickets", () => {
  it("collapses route tickets for the same journey, keeping the most-progressed copy", () => {
    const j = { retailer: "route", bookingRef: "r1:2026-06-24:08:30", origin: "London Waterloo", destination: "Brighton", scheduledDeparture: "2026-06-24T08:30:00.000Z", scheduledArrival: "2026-06-24T08:30:00.000Z", pricePence: 0, ticketType: "single" as const };
    const eligible: Ticket = { id: "a", journey: j, destinationCrs: "BTN", toc: "", status: "eligible", pollAttempts: 0, fromRoute: true };
    const claimed: Ticket = { id: "b", journey: { ...j, bookingRef: "r2:2026-06-24:08:30" }, destinationCrs: "BTN", toc: "", status: "claimed", pollAttempts: 0, fromRoute: true };
    const out = dedupeRouteTickets([eligible, claimed]);
    expect(out.map((t) => t.status)).toEqual(["claimed"]);
  });
});

describe("removeTicket", () => {
  it("drops the ticket the user no longer wants tracked", () => {
    const ctx = ctxFor();
    ctx.state.tickets = [ticket("A"), ticket("B")];
    removeTicket(ctx, "A");
    expect(ctx.state.tickets.map((t) => t.id)).toEqual(["B"]);
  });
});

describe("sweep watched routes", () => {
  it("ignores delayed arrivals that did not start at the route's origin station", async () => {
    const now = new Date("2026-06-24T08:40:00.000Z");
    const at = (hhmm: string) => new Date(`2026-06-24T${hhmm}:00.000Z`);
    const board = {
      BTN: [
        { scheduledArrival: at("08:30"), actualArrival: at("08:52"), originCrs: "WAT" }, // mine
        { scheduledArrival: at("08:35"), actualArrival: at("08:57"), originCrs: "GTW" }, // not my origin
      ],
    };
    const ctx = ctxFor();
    ctx.demo = false;
    ctx.provider = new FakeArrivalProvider({}, board);
    ctx.state.config.routes = [{ id: "r1", label: "Commute", origin: "London Waterloo", destination: "Brighton", fromTime: "06:30", toTime: "10:00" }];
    await sweep(ctx, now);
    expect(ctx.state.tickets.filter((t) => t.fromRoute)).toHaveLength(1);
  });

  it("heals duplicate watched routes already in config", async () => {
    const ctx = ctxFor();
    ctx.demo = false;
    const r = { label: "Commute", origin: "London Waterloo", destination: "Brighton", fromTime: "06:30", toTime: "10:00" };
    ctx.state.config.routes = [{ ...r, id: "r1" }, { ...r, id: "r2" }];
    await sweep(ctx, new Date("2026-06-24T08:40:00.000Z"));
    expect(ctx.state.config.routes).toHaveLength(1);
  });
});

describe("sweep cancellations", () => {
  it("counts a cancelled booked service as a delay measured to the next train taken", async () => {
    const now = new Date("2026-06-24T09:40:00.000Z");
    const at = (hhmm: string) => new Date(`2026-06-24T${hhmm}:00.000Z`);
    const board = {
      BTN: [
        { scheduledArrival: at("08:30"), actualArrival: null, cancelled: true, originCrs: "WAT" }, // booked, cancelled
        { scheduledArrival: at("08:50"), actualArrival: at("09:12"), originCrs: "WAT" }, // the train actually taken
      ],
    };
    const ctx = ctxFor();
    ctx.demo = false;
    ctx.provider = new FakeArrivalProvider({}, board);
    ctx.state.config.routes = [{ id: "r1", label: "Commute", origin: "London Waterloo", destination: "Brighton", fromTime: "06:30", toTime: "10:00" }];
    await sweep(ctx, now);
    const t = ctx.state.tickets.find((x) => x.fromRoute);
    expect(t?.assessment?.delayMinutes).toBe(42); // 08:30 booked arrival -> 09:12 actual
  });

  it("flags the ticket so the user sees the cancellation caused the delay", async () => {
    const now = new Date("2026-06-24T09:40:00.000Z");
    const at = (hhmm: string) => new Date(`2026-06-24T${hhmm}:00.000Z`);
    const board = {
      BTN: [
        { scheduledArrival: at("08:30"), actualArrival: null, cancelled: true, originCrs: "WAT" },
        { scheduledArrival: at("08:50"), actualArrival: at("09:12"), originCrs: "WAT" },
      ],
    };
    const ctx = ctxFor();
    ctx.demo = false;
    ctx.provider = new FakeArrivalProvider({}, board);
    ctx.state.config.routes = [{ id: "r1", label: "Commute", origin: "London Waterloo", destination: "Brighton", fromTime: "06:30", toTime: "10:00" }];
    await sweep(ctx, now);
    expect(ctx.state.tickets.find((x) => x.fromRoute)?.cancelledConnection).toBe(true);
  });
});

describe("view", () => {
  it("collapses duplicate route tickets in the read model even before a sweep persists", () => {
    const ctx = ctxFor();
    const j = { retailer: "route", bookingRef: "r1:2026-06-24:08:30", origin: "London Waterloo", destination: "Brighton", scheduledDeparture: "2026-06-24T08:30:00.000Z", scheduledArrival: "2026-06-24T08:30:00.000Z", pricePence: 0, ticketType: "single" as const };
    ctx.state.tickets = [
      { id: "a", journey: j, destinationCrs: "BTN", toc: "", status: "eligible", pollAttempts: 0, fromRoute: true },
      { id: "b", journey: { ...j, bookingRef: "r2:2026-06-24:08:30" }, destinationCrs: "BTN", toc: "", status: "eligible", pollAttempts: 0, fromRoute: true },
    ];
    expect(view(ctx).tickets).toHaveLength(1);
  });
});

describe("claim", () => {
  it("lets the user file a manual claim on an action-required ticket", async () => {
    const ctx = ctxFor();
    // action-required is reached only after the delay is validated, so it carries an assessment.
    ctx.state.tickets = [{
      ...ticket("A"), status: "action-required", actualArrival: "2026-06-24T09:30:00.000Z",
      assessment: { delayMinutes: 30, eligible: true, refundPence: 2000, band: "50%" },
    }];
    const result = await claim(ctx, "A");
    expect(result.status).not.toBe("rejected");
  });
});

describe("markFiled", () => {
  it("marks an eligible ticket as claimed once the user files it on the portal", () => {
    const ctx = ctxFor();
    ctx.state.tickets = [{ ...ticket("A"), status: "eligible" }];
    markFiled(ctx, "A");
    expect(view(ctx).tickets[0].status).toBe("claimed");
  });
});

describe("addRoute", () => {
  const ctxFor = () => ({
    statePath: join(tmpdir(), `s-${randomBytes(4).toString("hex")}.json`), passphrase: "pw",
    state: defaultState(), provider: new FakeArrivalProvider(), executor: new ManualHelperExecutor(),
    demo: false,
  }) as Ctx;
  const henley = { label: "Henley → Paddington", origin: "Henley-On-Thames", destination: "London Paddington", fromTime: "06:30", toTime: "10:00", days: [1, 2, 3, 4, 5] };

  it("ignores a route identical to one already watched", () => {
    const ctx = ctxFor();
    addRoute(ctx, henley);
    addRoute(ctx, henley);
    expect(ctx.state.config.routes).toHaveLength(1);
  });

  it("syncs fares to the mirror route when both directions are watched", () => {
    const ctx = ctxFor();
    addRoute(ctx, henley);
    addRoute(ctx, { ...henley, label: "Paddington → Henley", origin: "London Paddington", destination: "Henley-On-Thames" });
    const outId = ctx.state.config.routes![0].id;
    setRouteFares(ctx, outId, { single: 1240 });
    expect(ctx.state.config.routes!.find((r) => r.origin === "London Paddington")!.fares?.single).toBe(1240);
  });

  it("re-prices existing eligible route tickets when the route's fares are set", () => {
    const ctx = ctxFor();
    addRoute(ctx, henley);
    const id = ctx.state.config.routes![0].id;
    ctx.state.tickets = [{
      ...ticket("t1"),
      journey: { ...ticket("t1").journey, origin: "Henley-On-Thames", destination: "London Paddington", scheduledArrival: "2026-06-26T08:25:00.000Z", pricePence: 0, ticketType: "single" },
      fromRoute: true, actualArrival: "2026-06-26T08:49:00.000Z",
      assessment: { delayMinutes: 24, eligible: true, refundPence: 0, band: "25%" },
    }];
    setRouteFares(ctx, id, { single: 1240 }); // 24 min late, single, 25% of £12.40 = £3.10
    expect(ctx.state.tickets[0].assessment!.refundPence).toBe(310);
  });
});

describe("setTicketDetails fare lookup", () => {
  const ctxFor = () => ({
    statePath: join(tmpdir(), `s-${randomBytes(4).toString("hex")}.json`), passphrase: "pw",
    state: defaultState(), provider: new FakeArrivalProvider(), executor: new ManualHelperExecutor(),
    demo: false,
  }) as Ctx;

  it("re-prices a route ticket to the route's stored fare for the newly-chosen type", () => {
    const ctx = ctxFor();
    ctx.state.config.routes = [{ id: "r1", label: "x", origin: "A", destination: "B", fromTime: "06:00", toTime: "10:00", fares: { season: 500 } }];
    ctx.state.tickets = [{
      ...ticket("t1"),
      journey: { ...ticket("t1").journey, bookingRef: "r1:2026-06-26:08:25", origin: "A", destination: "B", scheduledArrival: "2026-06-26T08:25:00.000Z", pricePence: 0, ticketType: "single" },
      fromRoute: true, actualArrival: "2026-06-26T09:25:00.000Z", // 60 min => 100% band
    }];
    setTicketDetails(ctx, "t1", { ticketType: "season" });
    expect(ctx.state.tickets[0].assessment!.refundPence).toBe(500); // 100% of the season fare
  });
});

describe("applyConfig defaultTicketType", () => {
  it("re-types and re-prices all route tickets when the global default changes", () => {
    const state = defaultState();
    state.config.routes = [{ id: "r1", label: "Commute", origin: "London Waterloo", destination: "Brighton", fromTime: "06:30", toTime: "10:00", fares: { single: 1240, return: 2480 } }];
    // Ticket was created as "single" (old default); route now has return fare too.
    state.tickets = [{
      ...ticket("t1"),
      journey: { ...ticket("t1").journey, origin: "London Waterloo", destination: "Brighton", scheduledArrival: "2026-06-26T08:25:00.000Z", pricePence: 1240, ticketType: "single" },
      fromRoute: true, actualArrival: "2026-06-26T08:49:00.000Z", // 24 min = 25% band
      assessment: { delayMinutes: 24, eligible: true, refundPence: 310, band: "25%" },
    }];
    const ctx: Ctx = {
      statePath: join(tmpdir(), `s-${randomBytes(4).toString("hex")}.json`),
      passphrase: "pw", state, provider: new FakeArrivalProvider(), executor: new ManualHelperExecutor(), demo: false,
    };
    applyConfig(ctx, { defaultTicketType: "return" });
    // Return fare 2480; 25% of per-leg (2480/2 = 1240) = 310
    expect(ctx.state.tickets[0].journey.ticketType).toBe("return");
    expect(ctx.state.tickets[0].journey.pricePence).toBe(2480);
    expect(ctx.state.tickets[0].assessment!.refundPence).toBe(310);
  });

  it("re-types pending route tickets that have not arrived yet", () => {
    const state = defaultState();
    state.config.routes = [{ id: "r1", label: "Commute", origin: "London Waterloo", destination: "Brighton", fromTime: "06:30", toTime: "10:00", fares: { single: 1240, return: 2480 } }];
    state.tickets = [{
      ...ticket("t1"),
      journey: { ...ticket("t1").journey, origin: "London Waterloo", destination: "Brighton", scheduledArrival: "2026-06-26T08:25:00.000Z", pricePence: 1240, ticketType: "single" },
      fromRoute: true, status: "awaiting-arrival", // pending: no actualArrival
    }];
    const ctx: Ctx = {
      statePath: join(tmpdir(), `s-${randomBytes(4).toString("hex")}.json`),
      passphrase: "pw", state, provider: new FakeArrivalProvider(), executor: new ManualHelperExecutor(), demo: false,
    };
    applyConfig(ctx, { defaultTicketType: "return" });
    expect(ctx.state.tickets[0].journey.ticketType).toBe("return");
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
