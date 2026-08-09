import { pathToFileURL } from "node:url";

function requireBaseUrl(value, name) {
  if (!value) throw new Error(`${name} is required.`);
  const url = new URL(value);
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error(`${name} must use HTTPS outside local rehearsal.`);
  }
  return url.toString().replace(/\/$/, "");
}

async function smokeFetch(fetchImpl, url, init = {}) {
  const response = await fetchImpl(url, {
    ...init,
    headers: { accept: "application/json", ...init.headers },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`Smoke request ${new URL(url).pathname} returned ${response.status}.`);
  return response;
}

async function expectJson(fetchImpl, url, predicate, init) {
  const response = await smokeFetch(fetchImpl, url, init);
  const body = await response.json();
  if (!predicate(body))
    throw new Error(`Smoke response ${new URL(url).pathname} had an invalid shape.`);
}

export async function runReleaseSmoke({ apiBaseUrl, fetchImpl = fetch, metricsToken, webBaseUrl }) {
  const api = requireBaseUrl(apiBaseUrl, "RELEASE_API_BASE_URL");
  const web = requireBaseUrl(webBaseUrl, "RELEASE_WEB_BASE_URL");
  if (!metricsToken || metricsToken.length < 32 || /\s/.test(metricsToken)) {
    throw new Error("OBSERVABILITY_METRICS_TOKEN must be the configured server-only smoke token.");
  }

  await expectJson(
    fetchImpl,
    `${web}/health`,
    (body) => body?.data?.service === "web" && body.data.status === "ok",
  );
  await expectJson(
    fetchImpl,
    `${api}/health`,
    (body) => body?.data?.service === "api" && body.data.status === "ok",
  );
  await expectJson(
    fetchImpl,
    `${api}/ready`,
    (body) =>
      body?.data?.status === "ready" &&
      body.data.checks?.database === "ok" &&
      body.data.checks?.queue === "ok",
  );

  const metrics = await smokeFetch(fetchImpl, `${api}/internal/metrics`, {
    headers: { authorization: `Bearer ${metricsToken}` },
  });
  const metricsBody = await metrics.text();
  if (!metricsBody.includes("roavia_api_requests_total")) {
    throw new Error("Authenticated metrics smoke did not return Roavia API metrics.");
  }

  const manifest = await smokeFetch(fetchImpl, `${web}/manifest.webmanifest`);
  const manifestBody = await manifest.json();
  if (manifestBody?.name !== "Roavia" || manifestBody?.start_url !== "/") {
    throw new Error("PWA manifest smoke response was invalid.");
  }

  return { api, checks: 5, web };
}

async function main() {
  const result = await runReleaseSmoke({
    apiBaseUrl: process.env.RELEASE_API_BASE_URL,
    metricsToken: process.env.OBSERVABILITY_METRICS_TOKEN,
    webBaseUrl: process.env.RELEASE_WEB_BASE_URL,
  });
  console.log(`Release smoke passed ${result.checks} checks for ${result.web} and ${result.api}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
