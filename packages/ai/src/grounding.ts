import { z } from "zod";

const identifierSchema = z.string().trim().min(1).max(128);
const shortTextSchema = z.string().trim().min(1).max(500);

export const groundingKindSchema = z.enum(["place", "practical", "seasonality", "route"]);
export type GroundingKind = z.infer<typeof groundingKindSchema>;

export const groundingSourceSchema = z
  .object({
    sourceId: identifierSchema,
    provider: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(240),
    url: z.url(),
    kind: z.enum([
      "official_authority",
      "official_operator",
      "licensed_provider",
      "reviewed_editorial",
    ]),
    trustTier: z.enum(["tier_1", "tier_2", "tier_3", "tier_4"]),
    retrievedAt: z.iso.datetime({ offset: true }),
    publishedAt: z.iso.datetime({ offset: true }).nullable(),
    validFrom: z.iso.datetime({ offset: true }).nullable(),
    validUntil: z.iso.datetime({ offset: true }).nullable(),
    official: z.boolean(),
    license: z.string().trim().min(1).max(240).nullable(),
    licenseUrl: z.url().nullable(),
    attributionText: z.string().trim().min(1).max(500).nullable(),
  })
  .strict();

export type GroundingSource = z.infer<typeof groundingSourceSchema>;

const groundingFreshnessSchema = z
  .object({
    state: z.enum(["fresh", "stale", "expired", "unknown"]),
    observedAt: z.iso.datetime({ offset: true }),
    staleAt: z.iso.datetime({ offset: true }).nullable(),
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

const groundingConfidenceSchema = z
  .object({
    score: z.number().min(0).max(1),
    level: z.enum(["high", "medium", "low", "unknown"]),
    explanation: shortTextSchema,
  })
  .strict();

const groundingFactSchema = z
  .object({
    key: identifierSchema,
    value: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const groundingCandidateSchema = z
  .object({
    candidateId: identifierSchema,
    kind: groundingKindSchema,
    title: z.string().trim().min(1).max(240),
    content: z.string().trim().min(1).max(8_000),
    destinationIds: z.array(identifierSchema).min(1).max(25),
    keywords: z.array(z.string().trim().min(1).max(100)).max(50),
    sources: z.array(groundingSourceSchema).min(1).max(20),
    freshness: groundingFreshnessSchema,
    confidence: groundingConfidenceSchema,
    authority: z.enum(["official", "curated", "licensed"]),
    facts: z.array(groundingFactSchema).max(30),
  })
  .strict();

export type GroundingCandidate = z.infer<typeof groundingCandidateSchema>;

export type GroundingGapReason =
  | "budget_exhausted"
  | "expired_only"
  | "missing_kind"
  | "missing_source"
  | "source_invalid"
  | "source_unavailable"
  | "stale_only";

export interface GroundingGapInput {
  detail: string;
  kind?: GroundingKind;
  reason: GroundingGapReason;
}

export interface GroundingDataSourceResult {
  candidates: readonly GroundingCandidate[];
  gaps?: readonly GroundingGapInput[];
}

export interface GroundingDataSource {
  readonly name: string;
  readonly supportedKinds: readonly GroundingKind[];
  retrieve(request: ResolvedGroundingRequest): Promise<GroundingDataSourceResult>;
}

export interface GroundingBudget {
  maxEstimatedTokens: number;
  maxItemCharacters: number;
  maxItems: number;
  maxSources: number;
}

export interface GroundingTripContext {
  budgetStyle?: string;
  constraints?: readonly string[];
  dateWindow?: { endDate: string; startDate: string };
  destinationNames?: readonly string[];
  interests?: readonly string[];
  pace?: string;
  title?: string;
}

const groundingTripContextSchema = z
  .object({
    budgetStyle: z.string().trim().min(1).max(100).optional(),
    constraints: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
    dateWindow: z
      .object({
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .strict()
      .optional(),
    destinationNames: z.array(z.string().trim().min(1).max(240)).max(25).optional(),
    interests: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
    pace: z.string().trim().min(1).max(100).optional(),
    title: z.string().trim().min(1).max(240).optional(),
  })
  .strict();

export interface GroundingRequest {
  budget?: Partial<GroundingBudget>;
  destinationIds: readonly string[];
  locale?: string;
  purpose: "assistant" | "itinerary";
  query: string;
  requiredKinds: readonly GroundingKind[];
  tripContext?: GroundingTripContext;
}

export interface ResolvedGroundingRequest extends Omit<GroundingRequest, "budget"> {
  budget: GroundingBudget;
  locale: string;
  now: Date;
}

const DEFAULT_BUDGET: GroundingBudget = {
  maxEstimatedTokens: 2_500,
  maxItemCharacters: 2_000,
  maxItems: 12,
  maxSources: 20,
};

const requestSchema = z
  .object({
    destinationIds: z.array(identifierSchema).min(1).max(25),
    locale: z.string().trim().min(2).max(35),
    purpose: z.enum(["assistant", "itinerary"]),
    query: z.string().trim().min(1).max(1_000),
    requiredKinds: z.array(groundingKindSchema).min(1).max(4),
    tripContext: groundingTripContextSchema.optional(),
    budget: z
      .object({
        maxEstimatedTokens: z.number().int().min(128).max(100_000),
        maxItemCharacters: z.number().int().min(100).max(8_000),
        maxItems: z.number().int().min(1).max(50),
        maxSources: z.number().int().min(1).max(100),
      })
      .strict(),
  })
  .strict();

const groundingGapSchema = z
  .object({
    detail: shortTextSchema,
    kind: groundingKindSchema.nullable(),
    reason: z.enum([
      "budget_exhausted",
      "expired_only",
      "missing_kind",
      "missing_source",
      "source_invalid",
      "source_unavailable",
      "stale_only",
    ]),
    sourceName: z.string().trim().min(1).max(100).nullable(),
  })
  .strict();

const groundingContextItemSchema = groundingCandidateSchema
  .omit({ keywords: true, sources: true })
  .extend({
    rankScore: z.number().min(0).max(1),
    sourceIds: z.array(identifierSchema).min(1).max(20),
  })
  .strict();

const groundingConflictSchema = z
  .object({
    factKey: identifierSchema,
    variants: z
      .array(
        z
          .object({
            candidateIds: z.array(identifierSchema).min(1).max(50),
            sourceIds: z.array(identifierSchema).min(1).max(100),
            value: z.string().trim().min(1).max(1_000),
          })
          .strict(),
      )
      .min(2)
      .max(20),
  })
  .strict();

export const GROUNDING_CONTEXT_SCHEMA_VERSION = "roavia.grounding.v1" as const;

export const groundingContextSchema = z
  .object({
    schemaVersion: z.literal(GROUNDING_CONTEXT_SCHEMA_VERSION),
    status: z.enum(["complete", "partial", "empty"]),
    purpose: z.enum(["assistant", "itinerary"]),
    query: z.string().trim().min(1).max(1_000),
    destinationIds: z.array(identifierSchema).min(1).max(25),
    requiredKinds: z.array(groundingKindSchema).min(1).max(4),
    tripContext: groundingTripContextSchema.nullable(),
    items: z.array(groundingContextItemSchema).max(50),
    sources: z.array(groundingSourceSchema).max(100),
    gaps: z.array(groundingGapSchema).max(100),
    conflicts: z.array(groundingConflictSchema).max(30),
    renderedContext: z.string().max(400_000),
    budget: z
      .object({
        maxEstimatedTokens: z.number().int().positive(),
        usedEstimatedTokens: z.number().int().nonnegative(),
        maxItemCharacters: z.number().int().positive(),
        maxItems: z.number().int().positive(),
        maxSources: z.number().int().positive(),
        truncated: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((context, refinement) => {
    const sourceIds = new Set<string>();
    for (const [index, source] of context.sources.entries()) {
      if (sourceIds.has(source.sourceId)) {
        refinement.addIssue({
          code: "custom",
          message: "Grounding source identifiers must be unique.",
          path: ["sources", index, "sourceId"],
        });
      }
      sourceIds.add(source.sourceId);
    }
    for (const [itemIndex, item] of context.items.entries()) {
      for (const [sourceIndex, sourceId] of item.sourceIds.entries()) {
        if (!sourceIds.has(sourceId)) {
          refinement.addIssue({
            code: "custom",
            message: "Grounding item references an unknown source.",
            path: ["items", itemIndex, "sourceIds", sourceIndex],
          });
        }
      }
    }
    if (context.budget.usedEstimatedTokens > context.budget.maxEstimatedTokens) {
      refinement.addIssue({
        code: "custom",
        message: "Rendered grounding context exceeds its token budget.",
        path: ["budget", "usedEstimatedTokens"],
      });
    }
  });

export type GroundingContext = z.infer<typeof groundingContextSchema>;

type RankedCandidate = { candidate: GroundingCandidate; rankScore: number };
type ContextGap = z.infer<typeof groundingGapSchema>;

const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;
const AUTHORITY_SCORE = { curated: 0.09, licensed: 0.04, official: 0.15 } as const;
const FRESHNESS_SCORE = { expired: 0, fresh: 0.12, stale: 0.04, unknown: 0.02 } as const;

function tokens(value: string): Set<string> {
  return new Set(
    (value.normalize("NFKC").toLocaleLowerCase().match(TOKEN_PATTERN) ?? []).filter(
      (token) => token.length > 1,
    ),
  );
}

function rankCandidate(candidate: GroundingCandidate, query: string): number {
  const queryTokens = tokens(query);
  const title = candidate.title.normalize("NFKC").toLocaleLowerCase();
  const searchable = tokens(
    `${candidate.title} ${candidate.content} ${candidate.keywords.join(" ")}`,
  );
  const overlap = [...queryTokens].filter((token) => searchable.has(token)).length;
  const relevance = queryTokens.size === 0 ? 0 : overlap / queryTokens.size;
  const phrase = query.normalize("NFKC").toLocaleLowerCase();
  const titleBonus = title.includes(phrase) ? 0.2 : 0;
  const score =
    relevance * 0.44 +
    titleBonus +
    AUTHORITY_SCORE[candidate.authority] +
    FRESHNESS_SCORE[candidate.freshness.state] +
    candidate.confidence.score * 0.09;
  return Math.min(1, Math.round(score * 1_000) / 1_000);
}

function authorityOrder(authority: GroundingCandidate["authority"]): number {
  return authority === "official" ? 0 : authority === "curated" ? 1 : 2;
}

function compareRanked(left: RankedCandidate, right: RankedCandidate): number {
  return (
    right.rankScore - left.rankScore ||
    authorityOrder(left.candidate.authority) - authorityOrder(right.candidate.authority) ||
    right.candidate.confidence.score - left.candidate.confidence.score ||
    left.candidate.candidateId.localeCompare(right.candidate.candidateId)
  );
}

function truncateText(value: string, maxCharacters: number): string {
  if (value.length <= maxCharacters) return value;
  const slice = value.slice(0, Math.max(1, maxCharacters - 1));
  const boundary = slice.lastIndexOf(" ");
  return `${slice.slice(0, boundary > maxCharacters / 2 ? boundary : undefined).trimEnd()}…`;
}

export function estimateGroundingTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function uniqueSources(selected: readonly RankedCandidate[]): GroundingSource[] {
  const byId = new Map<string, GroundingSource>();
  for (const { candidate } of selected) {
    for (const source of candidate.sources) {
      if (!byId.has(source.sourceId)) byId.set(source.sourceId, source);
    }
  }
  return [...byId.values()].toSorted(
    (left, right) =>
      Number(right.official) - Number(left.official) ||
      left.trustTier.localeCompare(right.trustTier) ||
      left.sourceId.localeCompare(right.sourceId),
  );
}

function conflictsFor(selected: readonly RankedCandidate[]) {
  const facts = new Map<
    string,
    Map<string, { candidateIds: Set<string>; sourceIds: Set<string> }>
  >();
  for (const { candidate } of selected) {
    for (const fact of candidate.facts) {
      const values = facts.get(fact.key) ?? new Map();
      const support = values.get(fact.value) ?? {
        candidateIds: new Set<string>(),
        sourceIds: new Set<string>(),
      };
      support.candidateIds.add(candidate.candidateId);
      candidate.sources.forEach((source) => support.sourceIds.add(source.sourceId));
      values.set(fact.value, support);
      facts.set(fact.key, values);
    }
  }

  return [...facts.entries()].flatMap(([factKey, values]) =>
    values.size < 2
      ? []
      : [
          {
            factKey,
            variants: [...values.entries()].map(([value, support]) => ({
              candidateIds: [...support.candidateIds].toSorted(),
              sourceIds: [...support.sourceIds].toSorted(),
              value,
            })),
          },
        ],
  );
}

function renderContext(
  selected: readonly RankedCandidate[],
  gaps: readonly ContextGap[],
  conflicts: ReturnType<typeof conflictsFor>,
  tripContext?: GroundingTripContext,
): string {
  const lines = ["BEGIN ROAVIA GROUNDED EVIDENCE"];
  if (tripContext) {
    lines.push("AUTHORIZED TRIP CONTEXT");
    if (tripContext.title) lines.push(`Trip: ${tripContext.title}`);
    if (tripContext.destinationNames?.length) {
      lines.push(`Destinations: ${tripContext.destinationNames.join(", ")}`);
    }
    if (tripContext.dateWindow) {
      lines.push(
        `Date window: ${tripContext.dateWindow.startDate} to ${tripContext.dateWindow.endDate}`,
      );
    }
    if (tripContext.pace) lines.push(`Pace: ${tripContext.pace}`);
    if (tripContext.budgetStyle) lines.push(`Budget style: ${tripContext.budgetStyle}`);
    if (tripContext.interests?.length) {
      lines.push(`Interests: ${tripContext.interests.join(", ")}`);
    }
    if (tripContext.constraints?.length) {
      lines.push(`Constraints: ${tripContext.constraints.join("; ")}`);
    }
  }
  selected.forEach(({ candidate, rankScore }, index) => {
    lines.push(
      `[${index + 1}] ${candidate.title} | kind=${candidate.kind} | freshness=${candidate.freshness.state} | confidence=${candidate.confidence.level} | relevance=${rankScore.toFixed(3)}`,
      candidate.content,
      `source_ids=${candidate.sources.map((source) => source.sourceId).join(",")}`,
    );
  });
  if (gaps.length > 0) {
    lines.push("EVIDENCE GAPS");
    gaps.forEach((gap) =>
      lines.push(`${gap.reason}${gap.kind ? `:${gap.kind}` : ""} — ${gap.detail}`),
    );
  }
  if (conflicts.length > 0) {
    lines.push("CONFLICTING EVIDENCE");
    conflicts.forEach((conflict) =>
      lines.push(
        `${conflict.factKey}: ${conflict.variants.map((variant) => variant.value).join(" <> ")}`,
      ),
    );
  }
  lines.push("END ROAVIA GROUNDED EVIDENCE");
  return lines.join("\n");
}

/** Retrieves, ranks, validates, and serializes evidence without invoking an AI provider. */
export class GroundingRetriever {
  private readonly sources: readonly GroundingDataSource[];

  constructor(sources: readonly GroundingDataSource[]) {
    if (sources.length < 1 || sources.length > 20) {
      throw new RangeError("Grounding retrieval requires between 1 and 20 data sources.");
    }
    const names = new Set(sources.map((source) => source.name));
    if (names.size !== sources.length) {
      throw new Error("Grounding data source names must be unique.");
    }
    this.sources = sources;
  }

  async retrieve(input: GroundingRequest, now = new Date()): Promise<GroundingContext> {
    const request = requestSchema.parse({
      ...input,
      budget: { ...DEFAULT_BUDGET, ...input.budget },
      destinationIds: [...new Set(input.destinationIds)],
      locale: input.locale ?? "en",
      requiredKinds: [...new Set(input.requiredKinds)],
    });
    const resolvedRequest: ResolvedGroundingRequest = { ...request, now };
    const settled = await Promise.allSettled(
      this.sources.map((source) => source.retrieve(resolvedRequest)),
    );
    const candidates: GroundingCandidate[] = [];
    const gaps: ContextGap[] = [];

    settled.forEach((result, index) => {
      const source = this.sources[index]!;
      if (result.status === "rejected") {
        gaps.push({
          detail: `${source.name} could not provide grounding evidence.`,
          kind: null,
          reason: "source_unavailable",
          sourceName: source.name,
        });
        return;
      }
      for (const gap of result.value.gaps ?? []) {
        gaps.push({ ...gap, kind: gap.kind ?? null, sourceName: source.name });
      }
      for (const rawCandidate of result.value.candidates.slice(0, 200)) {
        const parsed = groundingCandidateSchema.safeParse(rawCandidate);
        if (!parsed.success) {
          gaps.push({
            detail: `${source.name} returned evidence that did not satisfy the grounding contract.`,
            kind: null,
            reason: "source_invalid",
            sourceName: source.name,
          });
          continue;
        }
        candidates.push(parsed.data);
      }
    });

    const ranked = candidates
      .map((candidate) => ({
        candidate: {
          ...candidate,
          content: truncateText(candidate.content, request.budget.maxItemCharacters),
        },
        rankScore: rankCandidate(candidate, request.query),
      }))
      .toSorted(compareRanked);
    const selected: RankedCandidate[] = [];
    const selectedIds = new Set<string>();
    const selectedSourceIds = new Set<string>();
    let truncated = false;

    const trySelect = (rankedCandidate: RankedCandidate): boolean => {
      if (selectedIds.has(rankedCandidate.candidate.candidateId)) return true;
      if (rankedCandidate.candidate.freshness.state === "expired") return false;
      const newSourceIds = rankedCandidate.candidate.sources.filter(
        (source) => !selectedSourceIds.has(source.sourceId),
      );
      if (
        selected.length >= request.budget.maxItems ||
        selectedSourceIds.size + newSourceIds.length > request.budget.maxSources
      ) {
        truncated = true;
        return false;
      }
      selected.push(rankedCandidate);
      selectedIds.add(rankedCandidate.candidate.candidateId);
      rankedCandidate.candidate.sources.forEach((source) => selectedSourceIds.add(source.sourceId));
      return true;
    };

    for (const kind of request.requiredKinds) {
      const matches = ranked.filter((candidate) => candidate.candidate.kind === kind);
      const usable = matches.find((candidate) => candidate.candidate.freshness.state !== "expired");
      if (!usable) {
        gaps.push({
          detail: matches.length
            ? `Only expired ${kind} evidence was available.`
            : `No ${kind} evidence was available for the resolved destinations.`,
          kind,
          reason: matches.length ? "expired_only" : "missing_kind",
          sourceName: null,
        });
        continue;
      }
      trySelect(usable);
      if (usable.candidate.freshness.state === "stale") {
        gaps.push({
          detail: `Only stale ${kind} evidence was selected.`,
          kind,
          reason: "stale_only",
          sourceName: null,
        });
      }
    }

    for (const rankedCandidate of ranked) {
      if (selected.length >= request.budget.maxItems) {
        truncated = ranked.some((candidate) => !selectedIds.has(candidate.candidate.candidateId));
        break;
      }
      trySelect(rankedCandidate);
    }

    let conflicts = conflictsFor(selected);
    let renderedContext = renderContext(selected, gaps, conflicts, request.tripContext);
    while (
      estimateGroundingTokens(renderedContext) > request.budget.maxEstimatedTokens &&
      selected.length > 0
    ) {
      selected.pop();
      truncated = true;
      conflicts = conflictsFor(selected);
      renderedContext = renderContext(selected, gaps, conflicts, request.tripContext);
    }
    if (estimateGroundingTokens(renderedContext) > request.budget.maxEstimatedTokens) {
      renderedContext = truncateText(renderedContext, request.budget.maxEstimatedTokens * 4);
      truncated = true;
    }
    if (truncated && !gaps.some((gap) => gap.reason === "budget_exhausted")) {
      gaps.push({
        detail: "Additional relevant evidence did not fit within the configured context budget.",
        kind: null,
        reason: "budget_exhausted",
        sourceName: null,
      });
    }

    const sources = uniqueSources(selected);
    const items = selected.map(({ candidate, rankScore }) => ({
      authority: candidate.authority,
      candidateId: candidate.candidateId,
      confidence: candidate.confidence,
      content: candidate.content,
      destinationIds: candidate.destinationIds,
      facts: candidate.facts,
      freshness: candidate.freshness,
      kind: candidate.kind,
      rankScore,
      sourceIds: candidate.sources.map((source) => source.sourceId),
      title: candidate.title,
    }));
    const missingRequired = request.requiredKinds.some(
      (kind) => !items.some((item) => item.kind === kind),
    );
    const context = {
      budget: {
        ...request.budget,
        truncated,
        usedEstimatedTokens: estimateGroundingTokens(renderedContext),
      },
      conflicts,
      destinationIds: request.destinationIds,
      gaps: gaps.slice(0, 100),
      items,
      purpose: request.purpose,
      query: request.query,
      renderedContext,
      requiredKinds: request.requiredKinds,
      schemaVersion: GROUNDING_CONTEXT_SCHEMA_VERSION,
      sources,
      status:
        items.length === 0
          ? ("empty" as const)
          : gaps.length > 0 || conflicts.length > 0 || missingRequired
            ? ("partial" as const)
            : ("complete" as const),
      tripContext: request.tripContext ?? null,
    };

    return groundingContextSchema.parse(context);
  }
}
