// Hard cap on solver attempts per claim, so a rogue/looping site script can't drain the user's
// BYOK solver balance (TC-002).
export const MAX_CAPTCHA_ATTEMPTS = 3;

export interface CaptchaOutcome {
  token?: string;
  attempts: number;
  exhausted: boolean;
}

/**
 * Run a single-attempt solver up to the cap. `solveOnce` returns a token on success or null on
 * failure; we never exceed MAX_CAPTCHA_ATTEMPTS calls regardless of how the site behaves.
 */
export async function solveWithCap(solveOnce: () => Promise<string | null>): Promise<CaptchaOutcome> {
  let attempts = 0;
  while (attempts < MAX_CAPTCHA_ATTEMPTS) {
    attempts++;
    const token = await solveOnce();
    if (token) return { token, attempts, exhausted: false };
  }
  return { attempts, exhausted: true };
}

// BYOK 2Captcha client (submit + poll). Network shell only; the cap above carries the test.
export function twoCaptchaSolveOnce(apiKey: string, sitekey: string, pageUrl: string) {
  return async (): Promise<string | null> => {
    const inUrl = `https://2captcha.com/in.php?key=${apiKey}&method=userrecaptcha&googlekey=${sitekey}&pageurl=${encodeURIComponent(pageUrl)}&json=1`;
    const created = (await (await fetch(inUrl)).json()) as { status: number; request: string };
    if (created.status !== 1) return null;

    const resUrl = `https://2captcha.com/res.php?key=${apiKey}&action=get&id=${created.request}&json=1`;
    // 2Captcha needs a few seconds to solve; poll a handful of times before giving up this attempt.
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const r = (await (await fetch(resUrl)).json()) as { status: number; request: string };
      if (r.status === 1) return r.request;
      if (r.request !== "CAPCHA_NOT_READY") return null;
    }
    return null;
  };
}
