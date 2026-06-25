import { describe, it, expect } from "vitest";
import { seal, open } from "./vault.js";

describe("vault", () => {
  it("round-trips data through encryption with the right passphrase", () => {
    const blob = seal({ token: "secret" }, "correct horse");
    expect(open(blob, "correct horse")).toEqual({ token: "secret" });
  });

  it("throws when the passphrase is wrong", () => {
    const blob = seal({ token: "secret" }, "correct horse");
    expect(() => open(blob, "wrong passphrase")).toThrow();
  });

  it("produces different ciphertext each time (random IV)", () => {
    const a = seal({ token: "secret" }, "pw");
    const b = seal({ token: "secret" }, "pw");
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
});
