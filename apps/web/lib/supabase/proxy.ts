import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { readSupabasePublicConfig } from "./config";

const protectedPrefixes = ["/assistant", "/plan", "/profile", "/trips"];
const authPrefixes = ["/auth/sign-in", "/auth/sign-up"];

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function localNextPath(pathname: string, search: string): string {
  return `${pathname}${search}`;
}

function redirectWithSession(destination: URL, sessionResponse: NextResponse): NextResponse {
  const response = NextResponse.redirect(destination);

  for (const cookie of sessionResponse.cookies.getAll()) {
    response.cookies.set(cookie);
  }

  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = sessionResponse.headers.get(header);
    if (value) {
      response.headers.set(header, value);
    }
  }

  return response;
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const config = readSupabasePublicConfig();
  const { pathname, search } = request.nextUrl;
  const protectedRoute = matchesPrefix(pathname, protectedPrefixes);

  if (!config) {
    if (!protectedRoute) {
      return NextResponse.next({ request });
    }

    const signInUrl = request.nextUrl.clone();
    signInUrl.pathname = "/auth/sign-in";
    signInUrl.search = "";
    signInUrl.searchParams.set("next", localNextPath(pathname, search));
    signInUrl.searchParams.set("reason", "configuration");
    return NextResponse.redirect(signInUrl);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        response = NextResponse.next({ request });

        for (const { name, options, value } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }

        for (const [name, value] of Object.entries(headers)) {
          response.headers.set(name, value);
        }
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();
  const authenticated = !error && Boolean(data?.claims.sub);

  if (protectedRoute && !authenticated) {
    const signInUrl = request.nextUrl.clone();
    signInUrl.pathname = "/auth/sign-in";
    signInUrl.search = "";
    signInUrl.searchParams.set("next", localNextPath(pathname, search));
    signInUrl.searchParams.set("reason", error ? "invalid" : "missing");
    return redirectWithSession(signInUrl, response);
  }

  if (authenticated && matchesPrefix(pathname, authPrefixes)) {
    const destination = request.nextUrl.clone();
    destination.pathname = "/trips";
    destination.search = "";
    return redirectWithSession(destination, response);
  }

  return response;
}
