import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

import { defineConfig } from "drizzle-kit";

try {
  loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw error;
  }
}

const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
  breakpoints: false,
  ...(databaseUrl ? { dbCredentials: { url: databaseUrl } } : {}),
});
