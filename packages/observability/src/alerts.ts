import {
  metricDefinitions,
  type MetricLabels,
  type MetricName,
  type MetricRegistry,
} from "./metrics.js";

export interface AlertRule {
  comparator: "gt" | "gte" | "lt" | "lte";
  description: string;
  id: string;
  labels?: Record<string, string>;
  metric: MetricName;
  runbook: string;
  severity: "critical" | "warning";
  threshold: number;
  windowMinutes: number;
}

export interface AlertEvaluation extends AlertRule {
  observedValue: number;
}

function compares(rule: AlertRule, value: number) {
  if (rule.comparator === "gt") return value > rule.threshold;
  if (rule.comparator === "gte") return value >= rule.threshold;
  if (rule.comparator === "lt") return value < rule.threshold;
  return value <= rule.threshold;
}

export function validateAlertRules(rules: readonly AlertRule[]) {
  const ids = new Set<string>();
  for (const rule of rules) {
    if (!/^[a-z][a-z0-9-]{2,79}$/.test(rule.id) || ids.has(rule.id)) {
      throw new Error(`Alert IDs must be unique kebab-case values: ${rule.id}.`);
    }
    ids.add(rule.id);
    if (!(rule.metric in metricDefinitions))
      throw new Error(`Unknown alert metric: ${rule.metric}.`);
    if (!Number.isFinite(rule.threshold) || rule.windowMinutes < 1) {
      throw new Error(`Alert ${rule.id} has an invalid threshold or window.`);
    }
    if (!rule.runbook.startsWith("docs/operations/observability.md#")) {
      throw new Error(`Alert ${rule.id} must link to the first-response runbook.`);
    }
  }
  return rules;
}

export function evaluateAlertRules(registry: MetricRegistry, rules: readonly AlertRule[]) {
  validateAlertRules(rules);
  return rules.flatMap<AlertEvaluation>((rule) => {
    const observedValue = registry.sum(rule.metric, (rule.labels ?? {}) as MetricLabels);
    return compares(rule, observedValue) ? [{ ...rule, observedValue }] : [];
  });
}
