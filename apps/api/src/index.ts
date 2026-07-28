import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { createAccessTokenVerifierFromEnvironment } from "./auth.js";

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
