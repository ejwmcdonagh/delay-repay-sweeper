import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { load, save, upsertTicket, defaultState } from "./store.js";
import type { Ticket } from "./types.js";

const ticket = (id: string): Ticket =>
  ({ id, journey: {} as any, destinationCrs: "MAN", toc: "AV", status: "awaiting-arrival", pollAttempts: 0 });

describe("store", () => {
  it("returns default state when the file does not exist", () => {
    const state = load(join(tmpdir(), `missing-${randomBytes(4).toString("hex")}.json`), "pw");
    expect(state).toEqual(defaultState());
  });

  it("round-trips state through an encrypted file", () => {
    const path = join(tmpdir(), `state-${randomBytes(4).toString("hex")}.json`);
    const state = defaultState();
    state.tickets = [ticket("a")];
    save(path, "pw", state);
    expect(load(path, "pw").tickets[0].id).toBe("a");
  });

  it("replaces an existing ticket by id instead of duplicating", () => {
    const first = upsertTicket([], ticket("a"));
    const updated = upsertTicket(first, { ...ticket("a"), status: "eligible" });
    expect(updated).toHaveLength(1);
    expect(updated[0].status).toBe("eligible");
  });
});
