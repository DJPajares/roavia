import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";
import { createDatabaseClient, searchDestinations } from "@roavia/db";

import { createApp } from "./app.js";
import { createAccessTokenVerifierFromEnvironment } from "./auth.js";

try {
  loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw error;
  }
}

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const database = process.env.DATABASE_URL
  ? createDatabaseClient(process.env.DATABASE_URL)
  : undefined;
const corsOrigins = process.env.CORS_ORIGINS?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const app = createApp({
  corsOrigins: corsOrigins && corsOrigins.length > 0 ? corsOrigins : undefined,
  verifyAccessToken: createAccessTokenVerifierFromEnvironment(process.env),
  searchDestinations: database ? (query) => searchDestinations(database.db, query) : undefined,
});

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`Roavia API listening on http://localhost:${info.port}`);
  },
);
