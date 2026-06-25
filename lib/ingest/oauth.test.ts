import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { generatePkce, buildAuthUrl, isExpired, buildXOAuth2 } from "./oauth.js";

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("generatePkce", () => {
  it("derives the challenge as the base64url SHA-256 of the verifier", () => {
    const { verifier, challenge } = generatePkce();
    expect(challenge).toBe(b64url(createHash("sha256").update(verifier).digest()));
  });
});

describe("buildAuthUrl", () => {
  it("requests an authorization code with PKCE and the client's id", () => {
    const url = new URL(buildAuthUrl("google", { clientId: "abc.apps", redirectUri: "http://127.0.0.1:4506", challenge: "chal", state: "st" }));
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("abc.apps");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("requests offline access so a refresh token is issued", () => {
    const url = new URL(buildAuthUrl("google", { clientId: "x", redirectUri: "http://127.0.0.1:4506", challenge: "c", state: "s" }));
    expect(url.searchParams.get("access_type")).toBe("offline");
  });
});

describe("isExpired", () => {
  it("treats a token expiring within the skew window as expired", () => {
    expect(isExpired(new Date("2026-06-25T12:00:30Z").toISOString(), new Date("2026-06-25T12:00:00Z"))).toBe(true);
  });

  it("treats a token well in the future as valid", () => {
    expect(isExpired(new Date("2026-06-25T13:00:00Z").toISOString(), new Date("2026-06-25T12:00:00Z"))).toBe(false);
  });
});

describe("buildXOAuth2", () => {
  it("encodes the SASL XOAUTH2 string for IMAP", () => {
    const decoded = Buffer.from(buildXOAuth2("me@gmail.com", "tok"), "base64").toString();
    expect(decoded).toBe("user=me@gmail.com\x01auth=Bearer tok\x01\x01");
  });
});
