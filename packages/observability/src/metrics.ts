export type MetricType = "counter" | "gauge" | "histogram";

interface MetricDefinition {
  buckets?: readonly number[];
  help: string;
  labels: readonly string[];
  type: MetricType;
}

const durationBuckets = [10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000];
const ageBuckets = [1, 5, 15, 30, 60, 300, 900, 3_600, 21_600, 86_400];

export const metricDefinitions = {
  roavia_ai_actions_total: {
    help: "Assistant actions by product decision outcome.",
    labels: ["outcome"],
    type: "counter",
  },
  roavia_ai_cost_micros_total: {
    help: "Estimated AI cost in micro-USD.",
    labels: ["operation", "provider"],
    type: "counter",
  },
  roavia_ai_duration_ms: {
    buckets: durationBuckets,
    help: "AI generation duration in milliseconds.",
    labels: ["operation", "provider", "outcome"],
    type: "histogram",
  },
  roavia_ai_generations_total: {
    help: "AI generations by operation, provider, and outcome.",
    labels: ["operation", "provider", "outcome"],
    type: "counter",
  },
  roavia_ai_repairs_total: {
    help: "AI repair attempts after validation failures.",
    labels: ["operation", "outcome"],
    type: "counter",
  },
  roavia_ai_tokens_total: {
    help: "AI tokens by operation, provider, and direction.",
    labels: ["operation", "provider", "direction"],
    type: "counter",
  },
  roavia_ai_unpriced_generations_total: {
    help: "AI generations without configured cost coverage.",
    labels: ["operation", "provider"],
    type: "counter",
  },
  roavia_ai_validation_failures_total: {
    help: "Schema or grounding validation failures.",
    labels: ["operation", "outcome"],
    type: "counter",
  },
  roavia_api_request_duration_ms: {
    buckets: durationBuckets,
    help: "API request duration in milliseconds.",
    labels: ["method", "route", "status_class"],
    type: "histogram",
  },
  roavia_api_requests_total: {
    help: "API requests by coarse route and outcome.",
    labels: ["method", "route", "status_class", "outcome"],
    type: "counter",
  },
  roavia_data_freshness_events_total: {
    help: "Provider cache and result freshness events.",
    labels: ["data_class", "operation", "state"],
    type: "counter",
  },
  roavia_job_dead_letter_oldest_age_seconds: {
    buckets: ageBuckets,
    help: "Age of the oldest current dead letter by job type.",
    labels: ["type"],
    type: "histogram",
  },
  roavia_job_dead_letters: {
    help: "Current dead-letter count by job type.",
    labels: ["type"],
    type: "gauge",
  },
  roavia_job_duration_ms: {
    buckets: durationBuckets,
    help: "Completed job duration in milliseconds.",
    labels: ["type", "event"],
    type: "histogram",
  },
  roavia_job_events_total: {
    help: "Durable job lifecycle events.",
    labels: ["type", "event"],
    type: "counter",
  },
  roavia_job_oldest_age_seconds: {
    help: "Age of the oldest inspectable job by job type and status.",
    labels: ["type", "status"],
    type: "gauge",
  },
  roavia_job_queue_delay_ms: {
    buckets: durationBuckets,
    help: "Delay from job availability to start in milliseconds.",
    labels: ["type"],
    type: "histogram",
  },
  roavia_job_queue_depth: {
    help: "Current inspectable job count by job type and status.",
    labels: ["type", "status"],
    type: "gauge",
  },
  roavia_offline_generation_duration_ms: {
    buckets: durationBuckets,
    help: "Offline package generation duration in milliseconds.",
    labels: ["outcome", "reused"],
    type: "histogram",
  },
  roavia_offline_generations_total: {
    help: "Offline package generation attempts and failures.",
    labels: ["outcome", "reused"],
    type: "counter",
  },
  roavia_provider_duration_ms: {
    buckets: durationBuckets,
    help: "Travel provider attempt duration in milliseconds.",
    labels: ["provider", "operation", "status"],
    type: "histogram",
  },
  roavia_provider_events_total: {
    help: "Travel provider, retry, quota, cache, and outage events.",
    labels: ["provider", "operation", "event", "status", "error_code"],
    type: "counter",
  },
  roavia_provider_quota_remaining: {
    help: "Last reported remaining provider quota.",
    labels: ["provider", "operation"],
    type: "gauge",
  },
  roavia_provider_usage_cost_units_total: {
    help: "Provider-reported usage cost units.",
    labels: ["provider", "operation"],
    type: "counter",
  },
} as const satisfies Record<string, MetricDefinition>;

export type MetricName = keyof typeof metricDefinitions;
export type MetricLabels = Readonly<Record<string, string>>;

interface ScalarSeries {
  labels: Record<string, string>;
  value: number;
}

interface HistogramSeries extends ScalarSeries {
  bucketCounts: number[];
  count: number;
  sum: number;
}

const unsafeLabelPattern =
  /(?:bearer\s+|sk-[a-z0-9_-]{12,}|eyJ[a-zA-Z0-9_-]{8,}\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b\d{4}-\d{2}-\d{2}\b)/i;

function metric(name: MetricName) {
  return metricDefinitions[name] as MetricDefinition;
}

function labelsFor(name: MetricName, labels: MetricLabels) {
  const definition = metric(name);
  const supplied = Object.keys(labels).toSorted();
  const expected = [...definition.labels].toSorted();
  if (supplied.join("\0") !== expected.join("\0")) {
    throw new Error(`${name} requires labels: ${definition.labels.join(", ")}.`);
  }
  return Object.fromEntries(
    definition.labels.map((label) => {
      const value = labels[label] ?? "unknown";
      const safe =
        value.length > 0 && value.length <= 120 && !unsafeLabelPattern.test(value)
          ? value
          : "redacted";
      return [label, safe];
    }),
  );
}

function seriesKey(name: MetricName, labels: Record<string, string>) {
  return `${name}\0${metric(name)
    .labels.map((label) => labels[label])
    .join("\0")}`;
}

function escapeHelp(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n");
}

function escapeLabel(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
}

function renderedLabels(labels: Record<string, string>, extra?: [string, string]) {
  const entries = [...Object.entries(labels), ...(extra ? [extra] : [])];
  if (entries.length === 0) return "";
  return `{${entries.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(",")}}`;
}

export class MetricRegistry {
  private readonly histograms = new Map<string, HistogramSeries>();
  private readonly scalars = new Map<string, ScalarSeries>();

  increment(name: MetricName, labels: MetricLabels, amount = 1) {
    if (metric(name).type !== "counter") throw new Error(`${name} is not a counter.`);
    if (!Number.isFinite(amount) || amount < 0) throw new Error("Counter increments must be >= 0.");
    const normalized = labelsFor(name, labels);
    const key = seriesKey(name, normalized);
    const current = this.scalars.get(key);
    this.scalars.set(key, { labels: normalized, value: (current?.value ?? 0) + amount });
  }

  observe(name: MetricName, labels: MetricLabels, value: number) {
    const definition = metric(name);
    if (definition.type !== "histogram") throw new Error(`${name} is not a histogram.`);
    if (!Number.isFinite(value) || value < 0) throw new Error("Histogram values must be >= 0.");
    const normalized = labelsFor(name, labels);
    const key = seriesKey(name, normalized);
    const buckets = definition.buckets ?? [];
    const current = this.histograms.get(key) ?? {
      bucketCounts: buckets.map(() => 0),
      count: 0,
      labels: normalized,
      sum: 0,
      value: 0,
    };
    for (const [index, upperBound] of buckets.entries()) {
      if (value <= upperBound) current.bucketCounts[index] = (current.bucketCounts[index] ?? 0) + 1;
    }
    current.count += 1;
    current.sum += value;
    current.value = current.count;
    this.histograms.set(key, current);
  }

  setGauge(name: MetricName, labels: MetricLabels, value: number) {
    if (metric(name).type !== "gauge") throw new Error(`${name} is not a gauge.`);
    if (!Number.isFinite(value) || value < 0) throw new Error("Gauge values must be >= 0.");
    const normalized = labelsFor(name, labels);
    this.scalars.set(seriesKey(name, normalized), { labels: normalized, value });
  }

  reset(name: MetricName) {
    const prefix = `${name}\0`;
    for (const key of this.scalars.keys()) if (key.startsWith(prefix)) this.scalars.delete(key);
    for (const key of this.histograms.keys())
      if (key.startsWith(prefix)) this.histograms.delete(key);
  }

  sum(name: MetricName, filter: MetricLabels = {}) {
    const prefix = `${name}\0`;
    const collection = metric(name).type === "histogram" ? this.histograms : this.scalars;
    let total = 0;
    for (const [key, series] of collection) {
      if (!key.startsWith(prefix)) continue;
      if (Object.entries(filter).every(([label, value]) => series.labels[label] === value)) {
        total += series.value;
      }
    }
    return total;
  }

  renderOpenMetrics() {
    const lines: string[] = [];
    for (const name of Object.keys(metricDefinitions).toSorted() as MetricName[]) {
      const definition = metric(name);
      lines.push(`# HELP ${name} ${escapeHelp(definition.help)}`);
      lines.push(`# TYPE ${name} ${definition.type}`);
      const prefix = `${name}\0`;
      if (definition.type === "histogram") {
        for (const [key, series] of [...this.histograms.entries()].toSorted(([a], [b]) =>
          a.localeCompare(b),
        )) {
          if (!key.startsWith(prefix)) continue;
          for (const [index, upperBound] of (definition.buckets ?? []).entries()) {
            lines.push(
              `${name}_bucket${renderedLabels(series.labels, ["le", String(upperBound)])} ${series.bucketCounts[index] ?? 0}`,
            );
          }
          lines.push(
            `${name}_bucket${renderedLabels(series.labels, ["le", "+Inf"])} ${series.count}`,
          );
          lines.push(`${name}_sum${renderedLabels(series.labels)} ${series.sum}`);
          lines.push(`${name}_count${renderedLabels(series.labels)} ${series.count}`);
        }
      } else {
        for (const [key, series] of [...this.scalars.entries()].toSorted(([a], [b]) =>
          a.localeCompare(b),
        )) {
          if (key.startsWith(prefix)) {
            lines.push(`${name}${renderedLabels(series.labels)} ${series.value}`);
          }
        }
      }
    }
    lines.push("# EOF");
    return `${lines.join("\n")}\n`;
  }
}
