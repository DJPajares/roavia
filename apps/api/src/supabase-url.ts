const LOCAL_SUPABASE_HOSTS = new Set(["127.0.0.1", "localhost"]);

export function normalizeSupabaseUrl(value: string): string {
  const url = new URL(value);
  const localDevelopment = LOCAL_SUPABASE_HOSTS.has(url.hostname);
  const hostedSupabase =
    url.hostname.endsWith(".supabase.co") && url.hostname.length > ".supabase.co".length;

  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("SUPABASE_URL must be a credential-free project origin.");
  }
  if (localDevelopment) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Local SUPABASE_URL must use HTTP or HTTPS.");
    }
  } else if (url.protocol !== "https:" || !hostedSupabase || url.port) {
    throw new Error("SUPABASE_URL must use HTTPS on an approved hosted Supabase project endpoint.");
  }

  return url.origin;
}
