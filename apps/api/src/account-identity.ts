import { normalizeSupabaseUrl } from "./supabase-url.js";

export interface AccountIdentityAdmin {
  deleteIdentity(authUserId: string): Promise<void>;
  revokeSessions(accessToken: string): Promise<void>;
}

export class AccountIdentityAdminError extends Error {
  readonly code: "auth_identity_deletion_failed" | "session_revocation_failed";

  constructor(code: AccountIdentityAdminError["code"]) {
    super(code);
    this.name = "AccountIdentityAdminError";
    this.code = code;
  }
}

interface SupabaseAccountIdentityAdminOptions {
  fetch?: typeof fetch;
  serviceRoleKey: string;
  url: string;
}

export function createSupabaseAccountIdentityAdmin(
  options: SupabaseAccountIdentityAdminOptions,
): AccountIdentityAdmin {
  const url = normalizeSupabaseUrl(options.url);
  const serviceRoleKey = options.serviceRoleKey.trim();
  if (serviceRoleKey.length < 32 || /\s/.test(serviceRoleKey)) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY must be a non-whitespace server secret.");
  }
  const request = options.fetch ?? globalThis.fetch;
  return {
    async revokeSessions(accessToken) {
      const response = await request(`${url}/auth/v1/logout?scope=global`, {
        headers: { apikey: serviceRoleKey, authorization: `Bearer ${accessToken}` },
        method: "POST",
        redirect: "error",
      });
      if (!response.ok && response.status !== 404) {
        throw new AccountIdentityAdminError("session_revocation_failed");
      }
    },

    async deleteIdentity(authUserId) {
      const response = await request(
        `${url}/auth/v1/admin/users/${encodeURIComponent(authUserId)}`,
        {
          body: JSON.stringify({ should_soft_delete: false }),
          headers: {
            apikey: serviceRoleKey,
            authorization: `Bearer ${serviceRoleKey}`,
            "content-type": "application/json",
          },
          method: "DELETE",
          redirect: "error",
        },
      );
      if (!response.ok && response.status !== 404) {
        throw new AccountIdentityAdminError("auth_identity_deletion_failed");
      }
    },
  };
}
