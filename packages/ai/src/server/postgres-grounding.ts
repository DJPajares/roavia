import { listGroundingContent, type Database, type GroundingContentRecord } from "@roavia/db";

import type {
  GroundingCandidate,
  GroundingDataSource,
  GroundingDataSourceResult,
  GroundingKind,
  ResolvedGroundingRequest,
} from "../grounding.js";

export interface PostgresGroundingDataSourceOptions {
  maxDepth?: number;
  maxPlaces?: number;
  maxRecords?: number;
}

const MAX_SERIALIZED_CONTENT_CHARACTERS = 8_000;
const OMITTED_CONTENT_KEYS = new Set(["publicationState"]);

function normalizeImportedText(value: string): string {
  const withoutControls = Array.from(value, (character) => {
    const code = character.codePointAt(0)!;
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127
      ? " "
      : character;
  }).join("");

  return withoutControls
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contentLines(value: unknown, path: readonly string[] = [], depth = 0): string[] {
  if (depth > 5 || value === null || value === undefined) return [];
  if (typeof value === "string") {
    const normalized = normalizeImportedText(value);
    return normalized ? [`${path.join(".") || "value"}: ${normalized}`] : [];
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return [`${path.join(".") || "value"}: ${String(value)}`];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      contentLines(item, [...path, String(index + 1)], depth + 1),
    );
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !OMITTED_CONTENT_KEYS.has(key))
      .toSorted(([left], [right]) => left.localeCompare(right))
      .flatMap(([key, item]) => contentLines(item, [...path, key], depth + 1));
  }
  return [];
}

function serializeContent(record: GroundingContentRecord): string {
  const lines = contentLines(record.content);
  const value = lines.length > 0 ? lines.join("\n") : record.place.canonicalName;
  return value.slice(0, MAX_SERIALIZED_CONTENT_CHARACTERS).trim();
}

function kindForContentType(contentType: string): GroundingKind | null {
  if (contentType === "media") return null;
  if (/^(overview|place|poi|destination)/.test(contentType)) return "place";
  if (/(season|climate|weather|event)/.test(contentType)) return "seasonality";
  if (/(route|transport|transit|transfer)/.test(contentType)) return "route";
  return "practical";
}

function authorityFor(record: GroundingContentRecord): GroundingCandidate["authority"] {
  if (
    record.sources.some(
      (source) => source.kind === "official_authority" || source.kind === "official_operator",
    )
  ) {
    return "official";
  }
  if (record.sources.some((source) => source.kind === "reviewed_editorial")) return "curated";
  return "licensed";
}

function factsFor(record: GroundingContentRecord): GroundingCandidate["facts"] {
  const rawFacts = record.content.facts;
  if (!rawFacts || typeof rawFacts !== "object" || Array.isArray(rawFacts)) return [];
  return Object.entries(rawFacts)
    .flatMap(([key, value]) =>
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? [{ key: key.slice(0, 128), value: String(value).slice(0, 1_000) }]
        : [],
    )
    .slice(0, 30);
}

function mapRecord(record: GroundingContentRecord): GroundingCandidate | null {
  const kind = kindForContentType(record.contentType);
  if (!kind || record.sources.length === 0) return null;
  const reviewed = record.reviewedAt !== null;

  return {
    authority: authorityFor(record),
    candidateId: `catalog-${record.id}`,
    confidence: {
      explanation: reviewed
        ? "The catalog record is approved and manually reviewed."
        : "The catalog record is approved but has no manual-review timestamp.",
      level: reviewed ? "high" : "medium",
      score: reviewed ? 0.9 : 0.75,
    },
    content: serializeContent(record),
    destinationIds: [record.place.id],
    facts: factsFor(record),
    freshness: {
      expiresAt: record.expiresAt.toISOString(),
      observedAt: record.refreshedAt.toISOString(),
      staleAt: record.staleAt.toISOString(),
      state: record.freshnessState,
    },
    keywords: [record.place.canonicalName, record.place.type, record.contentType],
    kind,
    sources: record.sources.map((source) => ({
      attributionText: source.attributionText,
      kind: source.kind,
      license: source.license,
      licenseUrl: source.licenseUrl,
      official: source.kind === "official_authority" || source.kind === "official_operator",
      provider: source.provider,
      publishedAt: source.publishedAt?.toISOString() ?? null,
      retrievedAt: source.retrievedAt.toISOString(),
      sourceId: source.id,
      title: source.title ?? source.provider,
      trustTier: source.trustTier,
      url: source.url,
      validFrom: source.validFrom?.toISOString() ?? null,
      validUntil: source.validUntil?.toISOString() ?? null,
    })),
    title: `${record.place.canonicalName} — ${record.contentType.replace(/[._-]+/g, " ")}`,
  };
}

/** Server-only adapter for approved content in the curated PostgreSQL catalog. */
export class PostgresGroundingDataSource implements GroundingDataSource {
  readonly name = "curated-postgres";
  readonly supportedKinds = ["place", "practical", "seasonality", "route"] as const;

  private readonly db: Database;
  private readonly options: PostgresGroundingDataSourceOptions;

  constructor(db: Database, options: PostgresGroundingDataSourceOptions = {}) {
    this.db = db;
    this.options = options;
  }

  async retrieve(request: ResolvedGroundingRequest): Promise<GroundingDataSourceResult> {
    const records = await listGroundingContent(this.db, {
      locale: request.locale,
      maxDepth: this.options.maxDepth ?? 2,
      maxPlaces: this.options.maxPlaces ?? 50,
      maxRecords: Math.min(this.options.maxRecords ?? request.budget.maxItems * 4, 100),
      now: request.now,
      placeIds: request.destinationIds,
    });
    const candidates: GroundingCandidate[] = [];
    let missingSourceCount = 0;

    for (const record of records) {
      const candidate = mapRecord(record);
      if (candidate) candidates.push(candidate);
      else if (record.contentType !== "media" && record.sources.length === 0)
        missingSourceCount += 1;
    }

    return {
      candidates,
      gaps:
        missingSourceCount > 0
          ? [
              {
                detail: `${missingSourceCount} approved catalog record(s) were excluded because provenance was missing.`,
                reason: "missing_source",
              },
            ]
          : [],
    };
  }
}
