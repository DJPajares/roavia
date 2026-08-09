import { pathToFileURL } from "node:url";

const renderApiBaseUrl = "https://api.render.com/v1";
const failedStatuses = new Set([
  "build_failed",
  "canceled",
  "deactivated",
  "failed",
  "update_failed",
]);

async function renderRequest(fetchImpl, apiKey, path, init = {}) {
  const response = await fetchImpl(`${renderApiBaseUrl}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Render API ${path} returned ${response.status}.`);
  return response.json();
}

export async function waitForDeploy({
  apiKey,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  fetchImpl = fetch,
  maxAttempts = 120,
  serviceId,
  deployId,
}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const deploy = await renderRequest(
      fetchImpl,
      apiKey,
      `/services/${encodeURIComponent(serviceId)}/deploys/${encodeURIComponent(deployId)}`,
    );
    if (deploy.status === "live") return deploy;
    if (failedStatuses.has(deploy.status)) {
      throw new Error(`Render rollback deploy ${deployId} ended with ${deploy.status}.`);
    }
    await delay(Math.min(30_000, 2_000 * 1.25 ** attempt));
  }
  throw new Error(`Render rollback deploy ${deployId} did not finish before the timeout.`);
}

export async function rollbackStack({ apiKey, fetchImpl = fetch, services, targets, waitOptions }) {
  if (!apiKey) throw new Error("RENDER_API_KEY is required.");
  const completed = [];

  for (const name of ["web", "worker", "api"]) {
    const serviceId = services[name];
    const targetDeployId = targets[name];
    if (!serviceId || !targetDeployId)
      throw new Error(`Missing ${name} service or target deploy ID.`);
    const rollback = await renderRequest(
      fetchImpl,
      apiKey,
      `/services/${encodeURIComponent(serviceId)}/rollback`,
      { body: JSON.stringify({ deployId: targetDeployId }), method: "POST" },
    );
    if (!rollback.id) throw new Error(`Render did not return a rollback deploy ID for ${name}.`);
    await waitForDeploy({
      apiKey,
      deployId: rollback.id,
      fetchImpl,
      serviceId,
      ...waitOptions,
    });
    completed.push({ deployId: rollback.id, service: name });
  }

  return completed;
}

async function main() {
  const completed = await rollbackStack({
    apiKey: process.env.RENDER_API_KEY,
    services: {
      api: process.env.RENDER_API_SERVICE_ID,
      web: process.env.RENDER_WEB_SERVICE_ID,
      worker: process.env.RENDER_WORKER_SERVICE_ID,
    },
    targets: {
      api: process.env.ROLLBACK_API_DEPLOY_ID,
      web: process.env.ROLLBACK_WEB_DEPLOY_ID,
      worker: process.env.ROLLBACK_WORKER_DEPLOY_ID,
    },
  });
  console.log(
    `Rollback rehearsal completed for ${completed.map(({ service }) => service).join(", ")}.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
