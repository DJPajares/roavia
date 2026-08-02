export interface ObservabilityEnvironment {
  NODE_ENV?: string;
  OBSERVABILITY_AGGREGATED_RETENTION_DAYS?: string;
  OBSERVABILITY_METRICS_TOKEN?: string;
  OBSERVABILITY_RAW_RETENTION_DAYS?: string;
  RENDER_GIT_COMMIT?: string;
}

export interface ObservabilityConfig {
  aggregatedRetentionDays: number;
  environment: string;
  metricsToken?: string;
  rawRetentionDays: number;
  releaseSha: string;
}

function retentionDays(value: string | undefined, fallback: number, maximum: number, name: string) {
  const parsed = value === undefined ? fallback : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}.`);
  }
  return parsed;
}

export function readObservabilityConfig(
  environment: ObservabilityEnvironment,
): ObservabilityConfig {
  const metricsToken = environment.OBSERVABILITY_METRICS_TOKEN?.trim();
  if (metricsToken && (metricsToken.length < 32 || /\s/.test(metricsToken))) {
    throw new Error(
      "OBSERVABILITY_METRICS_TOKEN must contain at least 32 non-whitespace characters.",
    );
  }
  return {
    aggregatedRetentionDays: retentionDays(
      environment.OBSERVABILITY_AGGREGATED_RETENTION_DAYS,
      395,
      400,
      "OBSERVABILITY_AGGREGATED_RETENTION_DAYS",
    ),
    environment: environment.NODE_ENV?.trim() || "development",
    metricsToken: metricsToken || undefined,
    rawRetentionDays: retentionDays(
      environment.OBSERVABILITY_RAW_RETENTION_DAYS,
      30,
      30,
      "OBSERVABILITY_RAW_RETENTION_DAYS",
    ),
    releaseSha: environment.RENDER_GIT_COMMIT?.trim() || "local",
  };
}
