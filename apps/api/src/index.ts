import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";

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
const app = createApp({
  verifyAccessToken: createAccessTokenVerifierFromEnvironment(process.env),
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
