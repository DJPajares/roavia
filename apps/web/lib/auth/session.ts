import { authSessionDataSchema, type AuthSession } from "@roavia/contracts";

import { readSupabasePublicConfig } from "../supabase/config";
import { createClient } from "../supabase/server";

export async function getAuthSession(): Promise<AuthSession | null> {
  if (!readSupabasePublicConfig()) {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (error || !claims?.sub || typeof claims.exp !== "number") {
    return null;
  }

  const result = authSessionDataSchema.safeParse({
    identity: {
      userId: claims.sub,
      email: typeof claims.email === "string" ? claims.email : undefined,
    },
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  });

  return result.success ? result.data : null;
}
