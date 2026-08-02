import {
  authIdentitySchema,
  authSessionDataSchema,
  type ApiErrorCode,
  type AuthSession,
} from "@roavia/contracts";
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JSONWebKeySet,
} from "jose";

const DEFAULT_AUDIENCE = "authenticated";
const SUPPORTED_ALGORITHMS = ["ES256", "RS256", "EdDSA"];

export class AuthVerificationError extends Error {
  readonly code: Extract<ApiErrorCode, "invalid_session" | "session_expired">;

  constructor(code: AuthVerificationError["code"]) {
    super(code === "session_expired" ? "The session has expired." : "The session is invalid.");
    this.name = "AuthVerificationError";
    this.code = code;
  }
}

export type AccessTokenVerifier = (accessToken: string) => Promise<AuthSession>;

export interface SupabaseVerifierOptions {
  issuer: string;
  jwksUrl?: string;
  jwks?: JSONWebKeySet;
}

function normalizedIssuer(value: string): string {
  return value.replace(/\/+$/, "");
}

export function createSupabaseAccessTokenVerifier(
  options: SupabaseVerifierOptions,
): AccessTokenVerifier {
  const issuer = normalizedIssuer(options.issuer);
  const keySet = options.jwks
    ? createLocalJWKSet(options.jwks)
    : createRemoteJWKSet(new URL(options.jwksUrl ?? `${issuer}/.well-known/jwks.json`));

  return async (accessToken) => {
    try {
      const { payload } = await jwtVerify(accessToken, keySet, {
        algorithms: SUPPORTED_ALGORITHMS,
        audience: DEFAULT_AUDIENCE,
        issuer,
      });

      if (typeof payload.exp !== "number") {
        throw new AuthVerificationError("invalid_session");
      }

      if (payload.role !== "authenticated") {
        throw new AuthVerificationError("invalid_session");
      }

      return authSessionDataSchema.parse({
        identity: authIdentitySchema.parse({
          userId: payload.sub,
          email: typeof payload.email === "string" ? payload.email : undefined,
        }),
        expiresAt: new Date(payload.exp * 1000).toISOString(),
        issuedAt:
          typeof payload.iat === "number" ? new Date(payload.iat * 1000).toISOString() : undefined,
      });
    } catch (error) {
      if (error instanceof AuthVerificationError) {
        throw error;
      }

      if (error instanceof joseErrors.JWTExpired) {
        throw new AuthVerificationError("session_expired");
      }

      throw new AuthVerificationError("invalid_session");
    }
  };
}

export function createAccessTokenVerifierFromEnvironment(
  environment: Record<string, string | undefined>,
): AccessTokenVerifier {
  const provider = environment.AUTH_PROVIDER?.trim();

  if (!provider) {
    return () => Promise.reject(new Error("Authentication is not configured."));
  }

  if (provider !== "supabase") {
    throw new Error(`Unsupported AUTH_PROVIDER: ${provider}`);
  }

  const projectUrl = environment.SUPABASE_URL?.trim();
  if (!projectUrl) {
    throw new Error("SUPABASE_URL is required when AUTH_PROVIDER=supabase.");
  }

  const url = new URL(projectUrl);
  const localDevelopment = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(localDevelopment && url.protocol === "http:")) {
    throw new Error("SUPABASE_URL must use HTTPS outside local development.");
  }

  return createSupabaseAccessTokenVerifier({
    issuer: `${normalizedIssuer(url.toString())}/auth/v1`,
  });
}
