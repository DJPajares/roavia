export interface SupabasePublicConfig {
  publishableKey: string;
  url: string;
}

const publicEnvironment = {
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
};

function validSupabaseUrl(value: string): string {
  const url = new URL(value);
  const localDevelopment = url.hostname === "localhost" || url.hostname === "127.0.0.1";

  if (url.protocol !== "https:" && !(localDevelopment && url.protocol === "http:")) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must use HTTPS outside local development.");
  }

  return url.toString().replace(/\/$/, "");
}

export function readSupabasePublicConfig(
  environment: Record<string, string | undefined> = publicEnvironment,
): SupabasePublicConfig | null {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url && !publishableKey) {
    return null;
  }

  if (!url || !publishableKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be configured together.",
    );
  }

  return {
    publishableKey,
    url: validSupabaseUrl(url),
  };
}

export function requireSupabasePublicConfig(): SupabasePublicConfig {
  const config = readSupabasePublicConfig();
  if (!config) {
    throw new Error("Authentication is not configured in this environment.");
  }

  return config;
}
