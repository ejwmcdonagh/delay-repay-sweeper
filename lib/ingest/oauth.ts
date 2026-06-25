import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

// IMAP-over-OAuth2 for managed Gmail / Microsoft 365 inboxes. BYO client ID: the user registers
// their own OAuth app and pastes its client ID, so no shared server sits between them and their
// mail — the local-first mandate holds. We use authorization-code + PKCE with a loopback redirect,
// which is the flow that works without a client secret.

export type OAuthProvider = "google" | "microsoft";

interface ProviderSpec {
  authUrl: string;
  tokenUrl: string;
  scope: string;
}

const PROVIDERS: Record<OAuthProvider, ProviderSpec> = {
  google: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "https://mail.google.com/",
  },
  microsoft: {
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    // offline_access is what gets us a refresh token so the daemon never needs the user again.
    scope: "https://outlook.office.com/IMAP.AccessAsUser.All offline_access",
  },
};

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function buildAuthUrl(
  provider: OAuthProvider,
  opts: { clientId: string; redirectUri: string; challenge: string; state: string; loginHint?: string },
): string {
  const p = PROVIDERS[provider];
  const params = new URLSearchParams({
    response_type: "code",
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope: p.scope,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
    state: opts.state,
    access_type: "offline", // Google: required to receive a refresh token
    prompt: "consent",
  });
  if (opts.loginHint) params.set("login_hint", opts.loginHint);
  return `${p.authUrl}?${params}`;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** ISO expiry, computed from expires_in at fetch time. */
  expiry: string;
}

function toTokenSet(json: any, now: Date): TokenSet {
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiry: new Date(now.getTime() + (json.expires_in ?? 3600) * 1000).toISOString(),
  };
}

export async function exchangeCode(
  provider: OAuthProvider,
  opts: { clientId: string; code: string; redirectUri: string; verifier: string },
  now: Date = new Date(),
): Promise<TokenSet> {
  const res = await fetch(PROVIDERS[provider].tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: opts.clientId,
      code: opts.code,
      redirect_uri: opts.redirectUri,
      code_verifier: opts.verifier,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  return toTokenSet(await res.json(), now);
}

export async function refreshAccessToken(
  provider: OAuthProvider,
  opts: { clientId: string; refreshToken: string },
  now: Date = new Date(),
): Promise<TokenSet> {
  const res = await fetch(PROVIDERS[provider].tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: opts.clientId,
      refresh_token: opts.refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);
  const set = toTokenSet(await res.json(), now);
  // Refresh responses often omit the refresh token; keep the existing one.
  set.refreshToken ??= opts.refreshToken;
  return set;
}

/** 60-second skew so we never hand IMAP a token that expires mid-session. */
export function isExpired(expiry: string, now: Date = new Date()): boolean {
  return new Date(expiry).getTime() - 60_000 <= now.getTime();
}

/** SASL XOAUTH2 string an IMAP server expects, base64-encoded. */
export function buildXOAuth2(user: string, accessToken: string): string {
  return Buffer.from(`user=${user}\x01auth=Bearer ${accessToken}\x01\x01`).toString("base64");
}

// Interactive loopback login: spins a throwaway server on 127.0.0.1, opens the system browser,
// captures the redirected code, exchanges it for tokens. Returns once the user has consented.
export function authorize(provider: OAuthProvider, clientId: string, port = 4506): Promise<TokenSet> {
  const redirectUri = `http://127.0.0.1:${port}`;
  const { verifier, challenge } = generatePkce();
  const state = b64url(randomBytes(8));

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", redirectUri);
      const code = url.searchParams.get("code");
      if (!code) return;
      if (url.searchParams.get("state") !== state) {
        res.end("State mismatch — close this tab and retry.");
        server.close();
        return reject(new Error("oauth state mismatch"));
      }
      res.end("Connected. You can close this tab.");
      server.close();
      try {
        resolve(await exchangeCode(provider, { clientId, code, redirectUri, verifier }));
      } catch (e) {
        reject(e as Error);
      }
    });
    server.listen(port, "127.0.0.1", () => {
      const url = buildAuthUrl(provider, { clientId, redirectUri, challenge, state });
      const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      spawn(opener, [url], { shell: process.platform === "win32" });
      console.log(`Opening browser to authorise ${provider}. If it doesn't open, visit:\n${url}`);
    });
  });
}
