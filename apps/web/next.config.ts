import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

try {
  loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw error;
  }
}

function connectOrigins(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const url = new URL(value);
  const localDevelopment = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(localDevelopment && url.protocol === "http:")) {
    throw new Error("Browser connection origins must use HTTPS outside local development.");
  }
  return url.protocol === "https:"
    ? [url.origin, `wss://${url.host}`]
    : [url.origin, `ws://${url.host}`];
}

const connectSrc = [
  "'self'",
  ...connectOrigins(process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.API_BASE_URL),
  ...connectOrigins(process.env.NEXT_PUBLIC_SUPABASE_URL),
];
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src ${[...new Set(connectSrc)].join(" ")}`,
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  process.env.NODE_ENV === "production" ? "upgrade-insecure-requests" : "",
]
  .filter(Boolean)
  .join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",
  experimental: {
    useTypeScriptCli: true,
  },
  headers: async () => [{ headers: securityHeaders, source: "/(.*)" }],
  reactStrictMode: true,
};

export default nextConfig;
