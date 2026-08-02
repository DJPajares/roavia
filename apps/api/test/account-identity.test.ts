import { describe, expect, test, vi } from "vitest";

import {
  AccountIdentityAdminError,
  createSupabaseAccountIdentityAdmin,
} from "../src/account-identity.js";

const serviceRoleKey = "service-role-key-that-is-longer-than-32-characters";

describe("Supabase account identity administration", () => {
  test("revokes global sessions and hard-deletes the identity with server credentials", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const admin = createSupabaseAccountIdentityAdmin({
      fetch: request,
      serviceRoleKey,
      url: "https://auth.roavia.test",
    });

    await admin.revokeSessions("user-access-token");
    await admin.deleteIdentity("auth/user id");

    expect(request).toHaveBeenNthCalledWith(
      1,
      "https://auth.roavia.test/auth/v1/logout?scope=global",
      expect.objectContaining({
        headers: { apikey: serviceRoleKey, authorization: "Bearer user-access-token" },
        method: "POST",
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "https://auth.roavia.test/auth/v1/admin/users/auth%2Fuser%20id",
      expect.objectContaining({
        body: JSON.stringify({ should_soft_delete: false }),
        headers: expect.objectContaining({ authorization: `Bearer ${serviceRoleKey}` }),
        method: "DELETE",
      }),
    );
  });

  test("is idempotent for missing identities and normalizes provider failures", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const admin = createSupabaseAccountIdentityAdmin({
      fetch: request,
      serviceRoleKey,
      url: "https://auth.roavia.test",
    });

    await expect(admin.deleteIdentity("already-deleted")).resolves.toBeUndefined();
    await expect(admin.revokeSessions("access-token")).rejects.toEqual(
      new AccountIdentityAdminError("session_revocation_failed"),
    );
  });

  test("rejects unsafe configuration", () => {
    expect(() =>
      createSupabaseAccountIdentityAdmin({
        serviceRoleKey,
        url: "http://auth.roavia.test",
      }),
    ).toThrow(/HTTPS/);
    expect(() =>
      createSupabaseAccountIdentityAdmin({
        serviceRoleKey: "short",
        url: "https://auth.roavia.test",
      }),
    ).toThrow(/server secret/);
  });
});
