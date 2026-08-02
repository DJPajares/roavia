import { authSessionResponseSchema } from "@roavia/contracts";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { beforeAll, describe, expect, test } from "vitest";

import { createApp } from "../src/app.js";
import {
  createAccessTokenVerifierFromEnvironment,
  createSupabaseAccessTokenVerifier,
} from "../src/auth.js";

const issuer = "https://roavia-auth.test/auth/v1";
const userId = "11111111-1111-4111-8111-111111111111";
const email = "traveler@roavia.test";
const keyId = "roavia-test-key";

let privateKey: CryptoKey;
let verifyAccessToken: ReturnType<typeof createSupabaseAccessTokenVerifier>;

async function accessToken(options: {
  expiresAt: number;
  role?: string;
  signingKey?: CryptoKey;
}): Promise<string> {
  return new SignJWT({ email, role: options.role ?? "authenticated" })
    .setProtectedHeader({ alg: "ES256", kid: keyId, typ: "JWT" })
    .setAudience("authenticated")
    .setExpirationTime(options.expiresAt)
    .setIssuedAt()
    .setIssuer(issuer)
    .setSubject(userId)
    .sign(options.signingKey ?? privateKey);
}

beforeAll(async () => {
  const pair = await generateKeyPair("ES256");
  privateKey = pair.privateKey;
  const publicJwk = await exportJWK(pair.publicKey);

  verifyAccessToken = createSupabaseAccessTokenVerifier({
    issuer,
    jwks: {
      keys: [{ ...publicJwk, alg: "ES256", kid: keyId, use: "sig" }],
    },
  });
});

describe("API authentication", () => {
  test("returns the normalized identity for an authenticated session", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3_600;
    const app = createApp({ verifyAccessToken });
    const response = await app.request("/auth/session", {
      headers: { authorization: `Bearer ${await accessToken({ expiresAt })}` },
    });

    expect(response.status).toBe(200);
    expect(authSessionResponseSchema.parse(await response.json()).data).toEqual({
      identity: { email, userId },
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      issuedAt: expect.any(String),
    });
  });

  test("returns authentication_required when the bearer token is missing", async () => {
    const app = createApp({ verifyAccessToken });
    const response = await app.request("/auth/session");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "authentication_required" },
    });
  });

  test("returns invalid_session for malformed authorization", async () => {
    const app = createApp({ verifyAccessToken });
    const response = await app.request("/auth/session", {
      headers: { authorization: "Basic credentials" },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_session" },
    });
  });

  test("distinguishes expired sessions from other invalid tokens", async () => {
    const app = createApp({ verifyAccessToken });
    const expired = await app.request("/auth/session", {
      headers: {
        authorization: `Bearer ${await accessToken({ expiresAt: Math.floor(Date.now() / 1000) - 60 })}`,
      },
    });
    const otherPair = await generateKeyPair("ES256");
    const invalid = await app.request("/auth/session", {
      headers: {
        authorization: `Bearer ${await accessToken({
          expiresAt: Math.floor(Date.now() / 1000) + 3_600,
          signingKey: otherPair.privateKey,
        })}`,
      },
    });
    const wrongRole = await app.request("/auth/session", {
      headers: {
        authorization: `Bearer ${await accessToken({
          expiresAt: Math.floor(Date.now() / 1000) + 3_600,
          role: "anon",
        })}`,
      },
    });

    expect(expired.status).toBe(401);
    await expect(expired.json()).resolves.toMatchObject({
      error: { code: "session_expired" },
    });
    expect(invalid.status).toBe(401);
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: "invalid_session" },
    });
    expect(wrongRole.status).toBe(401);
    await expect(wrongRole.json()).resolves.toMatchObject({
      error: { code: "invalid_session" },
    });
  });

  test("fails closed for unsupported or insecure provider configuration", () => {
    expect(() => createAccessTokenVerifierFromEnvironment({ AUTH_PROVIDER: "unknown" })).toThrow(
      /Unsupported AUTH_PROVIDER/,
    );
    expect(() => createAccessTokenVerifierFromEnvironment({ AUTH_PROVIDER: "supabase" })).toThrow(
      /SUPABASE_URL is required/,
    );
    expect(() =>
      createAccessTokenVerifierFromEnvironment({
        AUTH_PROVIDER: "supabase",
        SUPABASE_URL: "http://auth.roavia.test",
      }),
    ).toThrow(/must use HTTPS/);
  });
});
