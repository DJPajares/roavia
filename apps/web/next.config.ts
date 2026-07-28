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

const nextConfig: NextConfig = {
  devIndicators: false,
  experimental: {
    useTypeScriptCli: true,
  },
  reactStrictMode: true,
};

export default nextConfig;
