import { describe, it, expect, vi } from "vitest";
import { solveWithCap, MAX_CAPTCHA_ATTEMPTS } from "./captcha.js";

describe("solveWithCap", () => {
  it("stops after the attempt cap and reports exhaustion without further calls (TC-002)", async () => {
    const solveOnce = vi.fn().mockResolvedValue(null);
    const outcome = await solveWithCap(solveOnce);
    expect(outcome.exhausted).toBe(true);
    expect(solveOnce).toHaveBeenCalledTimes(MAX_CAPTCHA_ATTEMPTS);
  });

  it("returns the token as soon as an attempt succeeds", async () => {
    const solveOnce = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce("tok");
    const outcome = await solveWithCap(solveOnce);
    expect(outcome.token).toBe("tok");
    expect(outcome.attempts).toBe(2);
  });
});
