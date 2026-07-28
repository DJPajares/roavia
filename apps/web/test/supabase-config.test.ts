import { describe, expect, test } from "vitest";

import { readSupabasePublicConfig } from "../lib/supabase/config";

describe("Supabase public configuration", () => {
  test("keeps the credential-free local scaffold available", () => {
    expect(readSupabasePublicConfig({})).toBeNull();
  });

  test("requires the URL and publishable key together", () => {
    expect(() =>
      readSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://roavia.supabase.co" }),
    ).toThrow(/configured together/);
  });

  test("requires HTTPS except for a local test provider", () => {
    expect(() =>
      readSupabasePublicConfig({
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
        NEXT_PUBLIC_SUPABASE_URL: "http://auth.roavia.test",
      }),
    ).toThrow(/must use HTTPS/);

    expect(
      readSupabasePublicConfig({
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      }),
    ).toEqual({
      publishableKey: "sb_publishable_test",
      url: "http://127.0.0.1:54321",
    });
  });
});
