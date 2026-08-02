import { metricDefinitions } from "./metrics.js";

export interface DashboardPanel {
  id: string;
  owner: string;
  queries: string[];
  title: string;
}

export interface DashboardManifest {
  aggregatedRetentionDays: number;
  panels: DashboardPanel[];
  rawRetentionDays: number;
  refreshSeconds: number;
  schemaVersion: number;
  title: string;
}

const metricReferencePattern = /\broavia_[a-z0-9_]+\b/g;

export function validateDashboardManifest(manifest: DashboardManifest) {
  if (manifest.schemaVersion !== 1) throw new Error("Unsupported dashboard schema version.");
  if (manifest.rawRetentionDays < 1 || manifest.rawRetentionDays > 30) {
    throw new Error("Dashboard raw retention must be from 1 to 30 days.");
  }
  if (manifest.aggregatedRetentionDays < 1 || manifest.aggregatedRetentionDays > 400) {
    throw new Error("Dashboard aggregate retention must be from 1 to 400 days.");
  }
  if (manifest.refreshSeconds < 15 || manifest.panels.length === 0) {
    throw new Error("Dashboard refresh and panel configuration is invalid.");
  }
  const ids = new Set<string>();
  const referenced = new Set<string>();
  for (const panel of manifest.panels) {
    if (!/^[a-z][a-z0-9-]{2,79}$/.test(panel.id) || ids.has(panel.id)) {
      throw new Error(`Dashboard panel IDs must be unique kebab-case values: ${panel.id}.`);
    }
    ids.add(panel.id);
    if (!panel.owner.trim() || !panel.title.trim() || panel.queries.length === 0) {
      throw new Error(`Dashboard panel ${panel.id} is incomplete.`);
    }
    for (const query of panel.queries) {
      const metrics = query.match(metricReferencePattern) ?? [];
      if (metrics.length === 0) throw new Error(`Dashboard query has no Roavia metric: ${query}.`);
      for (const metric of metrics) {
        const base = metric.endsWith("_bucket") ? metric.slice(0, -"_bucket".length) : metric;
        if (!(base in metricDefinitions)) throw new Error(`Unknown dashboard metric: ${metric}.`);
        referenced.add(base);
      }
    }
  }
  return { manifest, referencedMetrics: [...referenced].toSorted() };
}
