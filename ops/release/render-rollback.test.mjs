import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { rollbackStack } from "./render-rollback.mjs";

async function failedDeployFetch(_url, init = {}) {
  return init.method === "POST"
    ? new Response(JSON.stringify({ id: "dep-failed" }), { status: 201 })
    : new Response(JSON.stringify({ id: "dep-failed", status: "update_failed" }));
}

describe("Render rollback rehearsal", () => {
  it("rolls back web, worker, then API and waits for each artifact", async () => {
    const calls = [];
    const statuses = new Map();
    const fetchImpl = async (url, init = {}) => {
      const pathname = new URL(url).pathname;
      calls.push(`${init.method ?? "GET"} ${pathname}`);
      if (init.method === "POST") {
        const service = pathname.split("/")[3];
        const id = `dep-rollback-${service}`;
        statuses.set(id, 0);
        return new Response(JSON.stringify({ id }), { status: 201 });
      }
      const id = pathname.split("/").at(-1);
      const count = statuses.get(id) ?? 0;
      statuses.set(id, count + 1);
      return new Response(
        JSON.stringify({ id, status: count === 0 ? "update_in_progress" : "live" }),
      );
    };

    const completed = await rollbackStack({
      apiKey: "render-api-key",
      fetchImpl,
      services: { api: "srv-api", web: "srv-web", worker: "srv-worker" },
      targets: { api: "dep-api-old", web: "dep-web-old", worker: "dep-worker-old" },
      waitOptions: { delay: () => Promise.resolve(), maxAttempts: 3 },
    });

    assert.deepEqual(
      completed.map(({ service }) => service),
      ["web", "worker", "api"],
    );
    assert.deepEqual(
      calls.filter((call) => call.startsWith("POST")),
      [
        "POST /v1/services/srv-web/rollback",
        "POST /v1/services/srv-worker/rollback",
        "POST /v1/services/srv-api/rollback",
      ],
    );
  });

  it("stops the stack rollback when a service fails", async () => {
    await assert.rejects(
      () =>
        rollbackStack({
          apiKey: "render-api-key",
          fetchImpl: failedDeployFetch,
          services: { api: "srv-api", web: "srv-web", worker: "srv-worker" },
          targets: { api: "dep-api-old", web: "dep-web-old", worker: "dep-worker-old" },
          waitOptions: { delay: () => Promise.resolve(), maxAttempts: 1 },
        }),
      /update_failed/,
    );
  });
});
