import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const renderRegions = new Set(["frankfurt", "ohio", "oregon", "singapore", "virginia"]);
const servicePlans = new Set(["starter", "standard", "pro", "pro plus", "pro max", "pro ultra"]);
const databasePlans = new Set([
  "basic-256mb",
  "basic-1gb",
  "basic-4gb",
  "pro-4gb",
  "pro-8gb",
  "pro-16gb",
  "pro-32gb",
  "pro-64gb",
  "pro-128gb",
  "pro-192gb",
  "pro-256gb",
  "pro-384gb",
  "pro-512gb",
  "accelerated-16gb",
  "accelerated-32gb",
  "accelerated-64gb",
  "accelerated-128gb",
  "accelerated-256gb",
  "accelerated-384gb",
  "accelerated-512gb",
  "accelerated-768gb",
  "accelerated-1024gb",
]);
const approvalKeys = ["budget", "dataResidency", "recovery", "supabaseResidency", "telemetry"];
const secretNames = {
  api: [
    "ACCOUNT_LIFECYCLE_SECRET",
    "ADVISORY_PROVIDER",
    "AI_API_KEY",
    "AI_INPUT_COST_PER_MILLION_USD",
    "AI_MODEL",
    "AI_OUTPUT_COST_PER_MILLION_USD",
    "AI_PROVIDER",
    "CURRENCY_PROVIDER",
    "DATABASE_URL",
    "HOLIDAY_API_KEY",
    "HOLIDAY_PROVIDER",
    "MAPS_API_KEY",
    "MAPS_PROVIDER",
    "OBSERVABILITY_METRICS_TOKEN",
    "ROAVIA_API_DATABASE_PASSWORD",
    "ROAVIA_WORKER_DATABASE_PASSWORD",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_URL",
    "TRAVEL_DATA_API_KEY",
    "TRAVEL_DATA_PROVIDER",
    "WEATHER_API_KEY",
    "WEATHER_PROVIDER",
  ],
  web: ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_URL"],
  worker: [
    "AI_API_KEY",
    "AI_INPUT_COST_PER_MILLION_USD",
    "AI_MODEL",
    "AI_OUTPUT_COST_PER_MILLION_USD",
    "AI_PROVIDER",
    "DATABASE_URL",
    "TRAVEL_DATA_API_KEY",
    "TRAVEL_DATA_PROVIDER",
    "WEATHER_API_KEY",
    "WEATHER_PROVIDER",
  ],
};

function fail(message) {
  throw new Error(`Invalid production release config: ${message}`);
}

function requireObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${name} must be an object.`);
  return value;
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${name} is required.`);
  if (/approval|required|example|change-me|todo/i.test(value))
    fail(`${name} still contains a placeholder.`);
  return value.trim();
}

function requirePositiveNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail(`${name} must be a positive number.`);
  }
  return value;
}

function requireApprovedDecision(value, name) {
  const decision = requireObject(value, `approvals.${name}`);
  requireString(decision.approvedBy, `approvals.${name}.approvedBy`);
  const approvedAt = new Date(requireString(decision.approvedAt, `approvals.${name}.approvedAt`));
  if (Number.isNaN(approvedAt.getTime()) || approvedAt.getTime() > Date.now()) {
    fail(`approvals.${name}.approvedAt must be a valid past timestamp.`);
  }
  const decisionUrl = requireString(decision.decisionUrl, `approvals.${name}.decisionUrl`);
  if (!/^https:\/\/linear\.app\/[^/]+\/(issue|document)\//.test(decisionUrl)) {
    fail(`approvals.${name}.decisionUrl must link to the recorded Linear decision.`);
  }
}

function requireDomain(value, name) {
  const domain = requireString(value, name).toLowerCase();
  const reservedSuffixes = [".example", ".invalid", ".local", ".localhost", ".test"];
  if (
    domain.includes(":") ||
    domain === "localhost" ||
    reservedSuffixes.some((suffix) => domain.endsWith(suffix))
  ) {
    fail(`${name} must be an owned production hostname without a scheme or port.`);
  }
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    fail(`${name} must be a valid hostname.`);
  }
  try {
    const url = new URL(`https://${domain}`);
    if (url.hostname !== domain || !domain.includes(".")) throw new Error("invalid");
  } catch {
    fail(`${name} must be a valid hostname.`);
  }
  return domain;
}

function requireRecentPricingDate(value) {
  const checkedAt = new Date(requireString(value, "pricing.checkedAt"));
  if (Number.isNaN(checkedAt.getTime()) || checkedAt.getTime() > Date.now()) {
    fail("pricing.checkedAt must be a valid past timestamp.");
  }
  if (Date.now() - checkedAt.getTime() > 30 * 24 * 60 * 60 * 1_000) {
    fail("pricing must be refreshed from Render within 30 days of Blueprint generation.");
  }
}

export function validateReleaseConfig(input) {
  const config = requireObject(input, "config");
  const region = requireString(config.region, "region");
  if (!renderRegions.has(region)) fail(`region must be one of ${[...renderRegions].join(", ")}.`);

  const servicePlan = requireString(config.servicePlan, "servicePlan");
  if (!servicePlans.has(servicePlan)) fail("servicePlan must be a paid Render service plan.");
  const databasePlan = requireString(config.databasePlan, "databasePlan");
  if (!databasePlans.has(databasePlan)) fail("databasePlan must be a paid Render Postgres plan.");

  const diskSizeGB = requirePositiveNumber(config.databaseDiskSizeGB, "databaseDiskSizeGB");
  if (!Number.isInteger(diskSizeGB) || (diskSizeGB !== 1 && diskSizeGB % 5 !== 0)) {
    fail("databaseDiskSizeGB must be 1 or a multiple of 5.");
  }

  if (typeof config.highAvailability !== "boolean") fail("highAvailability must be explicit.");
  const workspacePlan = requireString(config.workspacePlan, "workspacePlan").toLowerCase();
  if (!new Set(["hobby", "pro", "scale", "enterprise"]).has(workspacePlan)) {
    fail("workspacePlan must be hobby, pro, scale, or enterprise.");
  }
  if (
    config.highAvailability &&
    (workspacePlan === "hobby" || !/^(pro|accelerated)-/.test(databasePlan))
  ) {
    fail("high availability requires a Pro-or-higher workspace and database plan.");
  }

  const domains = requireObject(config.domains, "domains");
  const webDomain = requireDomain(domains.web, "domains.web");
  const apiDomain = requireDomain(domains.api, "domains.api");
  if (webDomain === apiDomain) fail("web and API domains must be distinct.");

  const pricing = requireObject(config.pricing, "pricing");
  requireRecentPricingDate(pricing.checkedAt);
  if (pricing.source !== "https://render.com/pricing") {
    fail("pricing.source must be the current Render pricing page.");
  }
  const estimatedMonthlyUsd = requirePositiveNumber(
    pricing.estimatedMonthlyUsd,
    "pricing.estimatedMonthlyUsd",
  );
  const monthlyBudgetUsd = requirePositiveNumber(config.monthlyBudgetUsd, "monthlyBudgetUsd");
  if (monthlyBudgetUsd < estimatedMonthlyUsd) {
    fail("monthlyBudgetUsd must cover the dated infrastructure estimate.");
  }

  const recovery = requireObject(config.recovery, "recovery");
  requirePositiveNumber(recovery.rpoMinutes, "recovery.rpoMinutes");
  requirePositiveNumber(recovery.rtoMinutes, "recovery.rtoMinutes");

  const retention = requireObject(config.retention, "retention");
  const rawDays = requirePositiveNumber(retention.rawDays, "retention.rawDays");
  const aggregatedDays = requirePositiveNumber(
    retention.aggregatedDays,
    "retention.aggregatedDays",
  );
  if (!Number.isInteger(rawDays) || rawDays > 30) fail("retention.rawDays must be 1 through 30.");
  if (!Number.isInteger(aggregatedDays) || aggregatedDays > 400) {
    fail("retention.aggregatedDays must be 1 through 400.");
  }

  requireString(config.supabaseRegion, "supabaseRegion");
  const alertDestinations = config.alertDestinations;
  if (!Array.isArray(alertDestinations) || alertDestinations.length === 0) {
    fail("alertDestinations must name at least one owned notification path.");
  }
  for (const [index, destination] of alertDestinations.entries()) {
    const item = requireObject(destination, `alertDestinations[${index}]`);
    requireString(item.label, `alertDestinations[${index}].label`);
    requireString(item.owner, `alertDestinations[${index}].owner`);
    if (!new Set(["email", "pagerduty", "slack", "webhook"]).has(item.channel)) {
      fail(`alertDestinations[${index}].channel is unsupported.`);
    }
  }

  const approvals = requireObject(config.approvals, "approvals");
  for (const key of approvalKeys) requireApprovedDecision(approvals[key], key);

  return {
    ...config,
    apiDomain,
    databaseDiskSizeGB: diskSizeGB,
    databasePlan,
    estimatedMonthlyUsd,
    region,
    retention: { aggregatedDays, rawDays },
    servicePlan,
    webDomain,
    workspacePlan,
  };
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function secretEnvironment(names, indent) {
  return names.map((name) => `${indent}- key: ${name}\n${indent}  sync: false`).join("\n");
}

function serviceEnvironment(values, secrets, indent) {
  const literals = Object.entries(values)
    .map(([key, value]) => `${indent}- key: ${key}\n${indent}  value: ${yamlString(value)}`)
    .join("\n");
  return `${literals}\n${secretEnvironment(secrets, indent)}`;
}

export function renderBlueprint(input, { phase = "application" } = {}) {
  const config = validateReleaseConfig(input);
  if (!new Set(["application", "foundation"]).has(phase)) {
    fail("phase must be foundation or application.");
  }
  if (phase === "foundation") {
    return `# Generated by ops/release/render-blueprint.mjs for foundation provisioning. Do not add secret values.\nprojects:\n  - name: roavia\n    environments:\n      - name: production\n        networking:\n          isolation: enabled\n        permissions:\n          protection: enabled\n        databases:\n          - name: roavia-db\n            region: ${config.region}\n            plan: ${config.databasePlan}\n            postgresMajorVersion: "17"\n            databaseName: roavia\n            user: roavia_migration\n            diskSizeGB: ${config.databaseDiskSizeGB}\n            storageAutoscalingEnabled: true\n            connectionPool: none\n            ipAllowList: []${
      config.highAvailability ? "\n            highAvailability:\n              enabled: true" : ""
    }\n`;
  }
  const commonEnvironment = {
    NODE_ENV: "production",
    NODE_VERSION: "24",
    OBSERVABILITY_AGGREGATED_RETENTION_DAYS: config.retention.aggregatedDays,
    OBSERVABILITY_RAW_RETENTION_DAYS: config.retention.rawDays,
  };
  const install =
    "corepack enable && corepack prepare pnpm@11.20.0 --activate && pnpm install --frozen-lockfile";

  return `# Generated by ops/release/render-blueprint.mjs. Do not add secret values.\nprojects:\n  - name: roavia\n    environments:\n      - name: production\n        networking:\n          isolation: enabled\n        permissions:\n          protection: enabled\n        services:\n          - name: roavia-api\n            type: web\n            runtime: node\n            region: ${config.region}\n            plan: ${yamlString(config.servicePlan)}\n            branch: main\n            autoDeployTrigger: off\n            buildCommand: ${yamlString(`${install} && pnpm --filter @roavia/api... build`)}\n            preDeployCommand: ${yamlString('DATABASE_URL="$MIGRATION_DATABASE_URL" pnpm db:migrate && pnpm db:bootstrap:production-roles')}\n            startCommand: ${yamlString("env -u MIGRATION_DATABASE_URL -u ROAVIA_API_DATABASE_PASSWORD -u ROAVIA_WORKER_DATABASE_PASSWORD pnpm --filter @roavia/api start")}\n            healthCheckPath: /ready\n            maxShutdownDelaySeconds: 60\n            domains:\n              - ${config.apiDomain}\n            envVars:\n${serviceEnvironment(
    {
      ...commonEnvironment,
      API_BASE_URL: `https://${config.apiDomain}`,
      APP_BASE_URL: `https://${config.webDomain}`,
      AUTH_PROVIDER: "supabase",
      CORS_ORIGINS: `https://${config.webDomain}`,
      PORT: "10000",
      TRUSTED_PROXY_HOPS: "1",
    },
    secretNames.api,
    "              ",
  )}\n              - key: MIGRATION_DATABASE_URL\n                fromDatabase:\n                  name: roavia-db\n                  property: connectionString\n          - name: roavia-worker\n            type: worker\n            runtime: node\n            region: ${config.region}\n            plan: ${yamlString(config.servicePlan)}\n            branch: main\n            autoDeployTrigger: off\n            buildCommand: ${yamlString(`${install} && pnpm --filter @roavia/worker... build`)}\n            startCommand: ${yamlString("pnpm --filter @roavia/worker start")}\n            maxShutdownDelaySeconds: 300\n            envVars:\n${serviceEnvironment(commonEnvironment, secretNames.worker, "              ")}\n          - name: roavia-web\n            type: web\n            runtime: node\n            region: ${config.region}\n            plan: ${yamlString(config.servicePlan)}\n            branch: main\n            autoDeployTrigger: off\n            buildCommand: ${yamlString(`${install} && pnpm --filter @roavia/web... build`)}\n            startCommand: ${yamlString("pnpm --filter @roavia/web start")}\n            healthCheckPath: /health\n            maxShutdownDelaySeconds: 60\n            domains:\n              - ${config.webDomain}\n            envVars:\n${serviceEnvironment(
    {
      ...commonEnvironment,
      API_BASE_URL: `https://${config.apiDomain}`,
      APP_BASE_URL: `https://${config.webDomain}`,
      NEXT_PUBLIC_API_BASE_URL: `https://${config.apiDomain}`,
    },
    secretNames.web,
    "              ",
  )}\n        databases:\n          - name: roavia-db\n            region: ${config.region}\n            plan: ${config.databasePlan}\n            postgresMajorVersion: "17"\n            databaseName: roavia\n            user: roavia_migration\n            diskSizeGB: ${config.databaseDiskSizeGB}\n            storageAutoscalingEnabled: true\n            connectionPool: none\n            ipAllowList: []${
    config.highAvailability ? "\n            highAvailability:\n              enabled: true" : ""
  }\n`;
}

function valueAfter(flag, arguments_) {
  const index = arguments_.indexOf(flag);
  return index === -1 ? undefined : arguments_[index + 1];
}

async function main(arguments_) {
  const configPath = valueAfter("--config", arguments_);
  const outputPath = valueAfter("--output", arguments_);
  const phase = valueAfter("--phase", arguments_);
  if (!configPath || !outputPath || !phase) {
    throw new Error(
      "Usage: node ops/release/render-blueprint.mjs --phase <foundation|application> --config <file> --output <file>",
    );
  }
  const config = JSON.parse(await readFile(configPath, "utf8"));
  await writeFile(outputPath, renderBlueprint(config, { phase }), {
    encoding: "utf8",
    mode: 0o600,
  });
  console.log(`Validated ${phase} production Blueprint written to ${outputPath}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
