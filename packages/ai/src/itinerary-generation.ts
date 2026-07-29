import { z } from "zod";

import type { AiGatewayError, AiGatewayMetadata, AiTokenUsage } from "./contracts.js";
import { AiGateway } from "./gateway.js";
import { groundingContextSchema, type GroundingContext } from "./grounding.js";
import { itineraryOutputV1Schema, type ItineraryOutputV1 } from "./schemas.js";

const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Invalid calendar date.");
const preferenceSchema = z.string().trim().min(1).max(200);
const currencySchema = z.string().regex(/^[A-Z]{3}$/);

const generationDestinationSchema = z
  .object({
    name: z.string().trim().min(1).max(240),
    placeId: z.uuid(),
    timezone: z.string().trim().min(1).max(100),
  })
  .strict();

const generationTravelerSchema = z
  .object({
    adults: z.number().int().min(0).max(50),
    children: z.number().int().min(0).max(50),
    infants: z.number().int().min(0).max(10),
  })
  .strict()
  .refine(({ adults, children, infants }) => {
    const total = adults + children + infants;
    return total >= 1 && total <= 50;
  }, "A generation request requires between 1 and 50 travelers.");

const generationBudgetSchema = z
  .object({
    amountMinor: z.number().int().min(0).max(100_000_000_000).nullable(),
    currency: currencySchema,
    style: z.enum(["budget", "midrange", "premium", "luxury"]),
  })
  .strict();

export const normalizedItineraryGenerationRequestSchema = z
  .object({
    accessibilityNeeds: z.array(preferenceSchema).max(30),
    budget: generationBudgetSchema,
    destinations: z.array(generationDestinationSchema).min(1).max(25),
    dietaryNeeds: z.array(preferenceSchema).max(30),
    endDate: localDateSchema,
    interests: z.array(preferenceSchema).max(30),
    locale: z.string().trim().min(2).max(35),
    maxTransferMinutes: z.number().int().min(15).max(720),
    maxTransfersPerDay: z.number().int().min(0).max(20),
    mustAvoid: z.array(preferenceSchema).max(30),
    mustDo: z.array(preferenceSchema).max(30),
    pace: z.enum(["slow", "balanced", "fast"]),
    startDate: localDateSchema,
    title: z.string().trim().min(1).max(240),
    travelers: generationTravelerSchema,
    tripId: z.uuid(),
    tripRevision: z.number().int().positive(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.endDate < request.startDate) {
      context.addIssue({
        code: "custom",
        message: "Trip end date cannot be before its start date.",
        path: ["endDate"],
      });
    }
    const destinationIds = request.destinations.map(({ placeId }) => placeId);
    if (new Set(destinationIds).size !== destinationIds.length) {
      context.addIssue({
        code: "custom",
        message: "Generation destinations must be unique.",
        path: ["destinations"],
      });
    }
  });

export type NormalizedItineraryGenerationRequest = z.infer<
  typeof normalizedItineraryGenerationRequestSchema
>;

function normalizeList(values: readonly string[]): string[] {
  return [
    ...new Set(values.map((value) => value.normalize("NFKC").trim()).filter(Boolean)),
  ].toSorted((left, right) => left.localeCompare(right));
}

/** Normalizes guided traveler fields without accepting a free-form planning prompt. */
export function normalizeItineraryGenerationRequest(
  input: unknown,
): NormalizedItineraryGenerationRequest {
  const parsed = normalizedItineraryGenerationRequestSchema.parse(input);
  return normalizedItineraryGenerationRequestSchema.parse({
    ...parsed,
    accessibilityNeeds: normalizeList(parsed.accessibilityNeeds),
    destinations: parsed.destinations,
    dietaryNeeds: normalizeList(parsed.dietaryNeeds),
    interests: normalizeList(parsed.interests),
    mustAvoid: normalizeList(parsed.mustAvoid),
    mustDo: normalizeList(parsed.mustDo),
    title: parsed.title.normalize("NFKC").trim(),
  });
}

export const itineraryValidationIssueCodeSchema = z.enum([
  "accessibility_conflict",
  "accessibility_unknown",
  "budget_conflict",
  "budget_unknown",
  "closed_availability",
  "currency_conflict",
  "duplicate_candidate_id",
  "duplicate_day",
  "duplicate_place",
  "excessive_transfer",
  "impossible_timing",
  "invalid_timezone",
  "model_blocking_warning",
  "outside_date_window",
  "unknown_availability",
  "unsupported_place",
  "unsupported_source",
]);

export type ItineraryValidationIssueCode = z.infer<typeof itineraryValidationIssueCodeSchema>;

export interface ItineraryValidationIssue {
  candidateIds: string[];
  code: ItineraryValidationIssueCode;
  message: string;
  repairable: boolean;
  severity: "blocking" | "warning";
}

export interface ItineraryValidationResult {
  blockingIssues: ItineraryValidationIssue[];
  issues: ItineraryValidationIssue[];
  valid: boolean;
  warnings: ItineraryValidationIssue[];
}

function issue(
  code: ItineraryValidationIssueCode,
  severity: ItineraryValidationIssue["severity"],
  message: string,
  candidateIds: readonly string[],
  repairable = true,
): ItineraryValidationIssue {
  return {
    candidateIds: [...new Set(candidateIds)].toSorted(),
    code,
    message,
    repairable,
    severity,
  };
}

function minutes(value: string): number {
  const [hours, minute] = value.split(":").map(Number);
  return hours! * 60 + minute!;
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function currencyMinorScale(currency: string): number {
  if (["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"].includes(currency)) return 1_000;
  if (
    [
      "BIF",
      "CLP",
      "DJF",
      "GNF",
      "ISK",
      "JPY",
      "KMF",
      "KRW",
      "PYG",
      "RWF",
      "UGX",
      "UYI",
      "VND",
      "VUV",
      "XAF",
      "XOF",
      "XPF",
    ].includes(currency)
  )
    return 1;
  return 100;
}

function placeFacts(context: GroundingContext): Map<string, Map<string, string[]>> {
  const result = new Map<string, Map<string, string[]>>();
  for (const item of context.items) {
    for (const destinationId of item.destinationIds) {
      const facts = result.get(destinationId) ?? new Map<string, string[]>();
      for (const fact of item.facts) {
        const key = fact.key.normalize("NFKC").toLowerCase();
        const values = facts.get(key) ?? [];
        values.push(fact.value.normalize("NFKC").trim().toLowerCase());
        facts.set(key, values);
      }
      result.set(destinationId, facts);
    }
  }
  return result;
}

function availabilityFor(facts: Map<string, string[]> | undefined): "closed" | "open" | "unknown" {
  const values = [...(facts?.get("availability") ?? []), ...(facts?.get("operating_status") ?? [])];
  if (
    values.some((value) =>
      /^(closed|unavailable|temporarily_closed|permanently_closed)$/.test(value),
    )
  ) {
    return "closed";
  }
  if (values.some((value) => /^(open|available)$/.test(value))) return "open";
  return "unknown";
}

function accessibilityFor(
  facts: Map<string, string[]> | undefined,
): "accessible" | "inaccessible" | "unknown" {
  const values = [
    ...(facts?.get("accessibility") ?? []),
    ...(facts?.get("wheelchair_accessible") ?? []),
  ];
  if (values.some((value) => /^(false|inaccessible|no|not_accessible)$/.test(value))) {
    return "inaccessible";
  }
  if (values.some((value) => /^(accessible|true|yes)$/.test(value))) return "accessible";
  return "unknown";
}

function confidenceValue(
  level: ItineraryOutputV1["days"][number]["items"][number]["confidence"]["level"],
): number {
  return { high: 0.9, low: 0.35, medium: 0.65, unknown: 0.15 }[level];
}

export function itineraryOverallConfidence(output: ItineraryOutputV1): number {
  const values = output.days.flatMap((day) =>
    day.items.map((item) => confidenceValue(item.confidence.level)),
  );
  if (values.length === 0) return 0;
  return (
    Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 1_000) / 1_000
  );
}

/** Applies provider-independent feasibility and provenance rules to a schema-valid candidate. */
export function validateItineraryCandidate(input: {
  candidate: ItineraryOutputV1;
  groundingContext: GroundingContext;
  request: NormalizedItineraryGenerationRequest;
}): ItineraryValidationResult {
  const candidate = itineraryOutputV1Schema.parse(input.candidate);
  const context = groundingContextSchema.parse(input.groundingContext);
  const request = normalizedItineraryGenerationRequestSchema.parse(input.request);
  const issues: ItineraryValidationIssue[] = [];
  const knownSources = new Map(context.sources.map((source) => [source.sourceId, source]));
  const knownPlaces = new Set(context.items.flatMap((item) => item.destinationIds));
  const factsByPlace = placeFacts(context);
  const candidateIds = new Set<string>();
  const dates = new Set<string>();
  const seenPlaces = new Map<string, string>();
  let estimatedTotalMinor = 0;
  let hasUnknownCost = false;

  for (const source of candidate.sources) {
    const grounded = knownSources.get(source.sourceId);
    if (
      !grounded ||
      grounded.url !== source.url ||
      grounded.title !== source.title ||
      grounded.retrievedAt !== source.retrievedAt ||
      grounded.official !== source.official ||
      grounded.validUntil !== source.validUntil
    ) {
      issues.push(
        issue(
          "unsupported_source",
          "blocking",
          "The candidate cites a source that is absent from or inconsistent with grounded context.",
          [],
        ),
      );
    }
  }

  for (const warning of candidate.warnings) {
    if (warning.severity === "blocking") {
      issues.push(
        issue(
          "model_blocking_warning",
          "blocking",
          "The model identified a blocking itinerary conflict.",
          warning.candidateIds,
        ),
      );
    }
  }

  for (const day of candidate.days) {
    if (candidateIds.has(day.candidateId)) {
      issues.push(
        issue("duplicate_candidate_id", "blocking", "Candidate identifiers must be unique.", [
          day.candidateId,
        ]),
      );
    }
    candidateIds.add(day.candidateId);
    if (dates.has(day.localDate)) {
      issues.push(
        issue("duplicate_day", "blocking", "An itinerary date appears more than once.", [
          day.candidateId,
        ]),
      );
    }
    dates.add(day.localDate);
    if (day.localDate < request.startDate || day.localDate > request.endDate) {
      issues.push(
        issue(
          "outside_date_window",
          "blocking",
          "An itinerary day falls outside the requested travel dates.",
          [day.candidateId],
        ),
      );
    }
    if (!isTimeZone(day.timezone)) {
      issues.push(
        issue("invalid_timezone", "blocking", "An itinerary day has an invalid IANA timezone.", [
          day.candidateId,
        ]),
      );
    }

    const transportItems = day.items.filter((item) => item.itemType === "transport");
    if (transportItems.length > request.maxTransfersPerDay) {
      issues.push(
        issue(
          "excessive_transfer",
          "blocking",
          "The day contains more transfers than the traveler request allows.",
          transportItems.map(({ candidateId }) => candidateId),
        ),
      );
    }

    let previousTimedItem: { candidateId: string; end: number } | undefined;
    for (const item of day.items) {
      if (candidateIds.has(item.candidateId)) {
        issues.push(
          issue("duplicate_candidate_id", "blocking", "Candidate identifiers must be unique.", [
            item.candidateId,
          ]),
        );
      }
      candidateIds.add(item.candidateId);

      if ((item.startTime === null) !== (item.endTime === null)) {
        issues.push(
          issue(
            "impossible_timing",
            "blocking",
            "An itinerary item must provide both start and end times or neither.",
            [item.candidateId],
          ),
        );
      } else if (item.startTime !== null && item.endTime !== null) {
        const start = minutes(item.startTime);
        const end = minutes(item.endTime);
        if (end <= start) {
          issues.push(
            issue("impossible_timing", "blocking", "An itinerary item ends before it starts.", [
              item.candidateId,
            ]),
          );
        }
        if (previousTimedItem && start < previousTimedItem.end) {
          issues.push(
            issue("impossible_timing", "blocking", "Timed itinerary items overlap.", [
              previousTimedItem.candidateId,
              item.candidateId,
            ]),
          );
        }
        if (item.durationMinutes !== null && Math.abs(end - start - item.durationMinutes) > 5) {
          issues.push(
            issue(
              "impossible_timing",
              "blocking",
              "An itinerary duration conflicts with its start and end times.",
              [item.candidateId],
            ),
          );
        }
        previousTimedItem = { candidateId: item.candidateId, end };
      }

      if (
        item.itemType === "transport" &&
        item.durationMinutes !== null &&
        item.durationMinutes > request.maxTransferMinutes
      ) {
        issues.push(
          issue(
            "excessive_transfer",
            "blocking",
            "A transfer exceeds the configured duration limit.",
            [item.candidateId],
          ),
        );
      }

      if (item.place?.placeId) {
        if (!knownPlaces.has(item.place.placeId)) {
          issues.push(
            issue(
              "unsupported_place",
              "blocking",
              "The candidate includes a place absent from grounded context.",
              [item.candidateId],
            ),
          );
        }
        if (item.itemType !== "accommodation" && item.itemType !== "transport") {
          const firstCandidateId = seenPlaces.get(item.place.placeId);
          if (firstCandidateId) {
            issues.push(
              issue("duplicate_place", "blocking", "The same place is scheduled more than once.", [
                firstCandidateId,
                item.candidateId,
              ]),
            );
          } else {
            seenPlaces.set(item.place.placeId, item.candidateId);
          }
        }

        if (!["accommodation", "break", "transport"].includes(item.itemType)) {
          const facts = factsByPlace.get(item.place.placeId);
          const availability = availabilityFor(facts);
          if (availability === "closed") {
            issues.push(
              issue(
                "closed_availability",
                "blocking",
                "A scheduled place is known to be closed or unavailable.",
                [item.candidateId],
              ),
            );
          } else if (availability === "unknown") {
            issues.push(
              issue(
                "unknown_availability",
                "warning",
                "Opening or availability evidence is unknown and should be confirmed.",
                [item.candidateId],
                false,
              ),
            );
          }

          if (request.accessibilityNeeds.length > 0) {
            const accessibility = accessibilityFor(facts);
            if (accessibility === "inaccessible") {
              issues.push(
                issue(
                  "accessibility_conflict",
                  "blocking",
                  "A scheduled place conflicts with the traveler's accessibility needs.",
                  [item.candidateId],
                ),
              );
            } else if (accessibility === "unknown") {
              issues.push(
                issue(
                  "accessibility_unknown",
                  "warning",
                  "Accessibility evidence is unknown and should be confirmed.",
                  [item.candidateId],
                  false,
                ),
              );
            }
          }
        }
      }

      if (item.estimatedCost === null) {
        if (!["break", "transport"].includes(item.itemType)) hasUnknownCost = true;
      } else if (
        item.estimatedCost.maximumAmount !== null &&
        item.estimatedCost.maximumAmount < item.estimatedCost.minimumAmount
      ) {
        issues.push(
          issue(
            "budget_conflict",
            "blocking",
            "An estimated cost range has a maximum below its minimum.",
            [item.candidateId],
          ),
        );
      } else if (item.estimatedCost.currencyCode !== request.budget.currency) {
        issues.push(
          issue(
            "currency_conflict",
            "blocking",
            "An estimated cost uses a currency different from the trip budget.",
            [item.candidateId],
          ),
        );
      } else {
        const amount = item.estimatedCost.maximumAmount ?? item.estimatedCost.minimumAmount;
        estimatedTotalMinor += Math.round(amount * currencyMinorScale(request.budget.currency));
      }
    }
  }

  if (request.budget.amountMinor !== null && estimatedTotalMinor > request.budget.amountMinor) {
    issues.push(
      issue(
        "budget_conflict",
        "blocking",
        "The itinerary's estimated total exceeds the requested budget.",
        [],
      ),
    );
  }
  if (request.budget.amountMinor !== null && hasUnknownCost) {
    issues.push(
      issue(
        "budget_unknown",
        "warning",
        "Some itinerary costs are unknown, so the budget estimate is incomplete.",
        [],
        false,
      ),
    );
  }

  const deduplicated = [
    ...new Map(
      issues.map((item) => [`${item.code}:${item.severity}:${item.candidateIds.join(",")}`, item]),
    ).values(),
  ];
  const blockingIssues = deduplicated.filter(({ severity }) => severity === "blocking");
  const warnings = deduplicated.filter(({ severity }) => severity === "warning");
  return { blockingIssues, issues: deduplicated, valid: blockingIssues.length === 0, warnings };
}

export type ItineraryGenerationStage = "generating" | "validating" | "repairing";

export interface ItineraryGenerationAttemptAudit {
  attemptNumber: number;
  cost?: AiGatewayMetadata["cost"];
  durationMs: number;
  generationId: string;
  issueCodes: string[];
  kind: "initial" | "repair";
  model: string;
  outcome: "accepted" | "provider_error" | "rejected";
  promptVersion: string;
  provider: string;
  repairNumber: number | null;
  usage?: AiTokenUsage;
}

export interface ItineraryGenerationEngineOptions {
  maxRepairAttempts?: number;
  promptVersion?: string;
  system?: string;
  timeoutMs?: number;
}

export interface ItineraryGenerationEngineInput {
  attemptOffset?: number;
  groundingContext: GroundingContext;
  maxRepairAttempts?: number;
  onAttempt?: (attempt: ItineraryGenerationAttemptAudit) => Promise<void> | void;
  onStage?: (stage: ItineraryGenerationStage) => Promise<void> | void;
  promptVersion?: string;
  repairOffset?: number;
  request: NormalizedItineraryGenerationRequest;
  requestId?: string;
  signal?: AbortSignal;
}

export interface ItineraryGenerationSuccess {
  attempts: ItineraryGenerationAttemptAudit[];
  draft: ItineraryOutputV1;
  overallConfidence: number;
  repairAttempts: number;
  status: "success";
  validation: ItineraryValidationResult;
}

export interface ItineraryGenerationFailure {
  attempts: ItineraryGenerationAttemptAudit[];
  error: {
    code: "provider_failure" | "validation_failed";
    gatewayError?: AiGatewayError;
    message: string;
    retryable: boolean;
  };
  repairAttempts: number;
  status: "error";
}

export type ItineraryGenerationResult = ItineraryGenerationFailure | ItineraryGenerationSuccess;

const DEFAULT_SYSTEM =
  "You create source-aware itinerary drafts from normalized traveler constraints and supplied evidence. Never invent sources, place IDs, availability, or accessibility facts. Return only the requested structured output.";

const PROMPT_FACT_KEYS = new Set([
  "accessibility",
  "availability",
  "closing_time",
  "opening_time",
  "operating_status",
  "wheelchair_accessible",
]);

function promptGroundingContext(groundingContext: GroundingContext) {
  return {
    evidence: groundingContext.renderedContext,
    items: groundingContext.items.map((item) => ({
      candidateId: item.candidateId,
      destinationIds: item.destinationIds,
      facts: item.facts
        .filter((fact) => PROMPT_FACT_KEYS.has(fact.key.toLowerCase()))
        .slice(0, 8)
        .map((fact) => ({ key: fact.key, value: fact.value.slice(0, 200) })),
      kind: item.kind,
      sourceIds: item.sourceIds,
      title: item.title,
    })),
    sources: groundingContext.sources.map((source) => ({
      official: source.official,
      retrievedAt: source.retrievedAt,
      sourceId: source.sourceId,
      title: source.title,
      url: source.url,
      validUntil: source.validUntil,
    })),
    status: groundingContext.status,
  };
}

function generationPrompt(
  request: NormalizedItineraryGenerationRequest,
  groundingContext: GroundingContext,
): string {
  return [
    "Create a feasible itinerary candidate for this normalized request.",
    "Use only source IDs and place IDs present in groundedContext. Unknown availability, cost, or accessibility must be surfaced as assumptions or warnings.",
    JSON.stringify({
      groundedContext: promptGroundingContext(groundingContext),
      request,
    }),
  ].join("\n");
}

function repairPrompt(
  request: NormalizedItineraryGenerationRequest,
  groundingContext: GroundingContext,
  candidate: ItineraryOutputV1,
  validation: ItineraryValidationResult,
): string {
  return [
    "Repair the itinerary candidate. Resolve every blocking validation issue without weakening traveler constraints or inventing evidence.",
    JSON.stringify({
      blockingIssues: validation.blockingIssues.map(({ candidateIds, code, message }) => ({
        candidateIds,
        code,
        message,
      })),
      candidate,
      groundedContext: promptGroundingContext(groundingContext),
      request,
    }),
  ].join("\n");
}

function withValidationWarnings(
  candidate: ItineraryOutputV1,
  validation: ItineraryValidationResult,
): ItineraryOutputV1 {
  const warnings = [...candidate.warnings];
  const keys = new Set(
    warnings.map((warning) => `${warning.code}:${warning.candidateIds.toSorted().join(",")}`),
  );
  for (const validationWarning of validation.warnings) {
    const code = `validation.${validationWarning.code}`;
    const key = `${code}:${validationWarning.candidateIds.join(",")}`;
    if (keys.has(key)) continue;
    warnings.push({
      candidateIds: validationWarning.candidateIds,
      code,
      severity: "warning",
      summary: validationWarning.message,
    });
    keys.add(key);
  }
  return itineraryOutputV1Schema.parse({ ...candidate, warnings });
}

/** Generates, validates, and boundedly repairs in memory; persistence is a separate stage. */
export class ItineraryGenerationEngine {
  private readonly gateway: AiGateway;
  private readonly maxRepairAttempts: number;
  private readonly promptVersion: string;
  private readonly system: string;
  private readonly timeoutMs?: number;

  constructor(gateway: AiGateway, options: ItineraryGenerationEngineOptions = {}) {
    this.gateway = gateway;
    this.maxRepairAttempts = options.maxRepairAttempts ?? 2;
    if (
      !Number.isInteger(this.maxRepairAttempts) ||
      this.maxRepairAttempts < 0 ||
      this.maxRepairAttempts > 3
    ) {
      throw new RangeError("Itinerary repair attempts must be an integer from 0 to 3.");
    }
    this.promptVersion = options.promptVersion ?? "itinerary-generation-v1";
    this.system = options.system ?? DEFAULT_SYSTEM;
    this.timeoutMs = options.timeoutMs;
  }

  async generate(rawInput: ItineraryGenerationEngineInput): Promise<ItineraryGenerationResult> {
    const request = normalizeItineraryGenerationRequest(rawInput.request);
    const groundingContext = groundingContextSchema.parse(rawInput.groundingContext);
    if (groundingContext.purpose !== "itinerary") {
      throw new TypeError("Itinerary generation requires itinerary grounding context.");
    }
    const requestedDestinations = new Set(request.destinations.map(({ placeId }) => placeId));
    if (
      groundingContext.destinationIds.length !== requestedDestinations.size ||
      groundingContext.destinationIds.some((id) => !requestedDestinations.has(id))
    ) {
      throw new TypeError("Grounding destinations do not match the normalized generation request.");
    }

    const attempts: ItineraryGenerationAttemptAudit[] = [];
    const attemptOffset = rawInput.attemptOffset ?? 0;
    const promptVersion = rawInput.promptVersion ?? this.promptVersion;
    const maxRepairAttempts = rawInput.maxRepairAttempts ?? this.maxRepairAttempts;
    if (!Number.isInteger(maxRepairAttempts) || maxRepairAttempts < 0 || maxRepairAttempts > 3) {
      throw new RangeError("Itinerary repair attempts must be an integer from 0 to 3.");
    }
    const repairOffset = rawInput.repairOffset ?? 0;
    let repairs = repairOffset;
    let candidate: ItineraryOutputV1 | undefined;
    let validation: ItineraryValidationResult | undefined;

    while (true) {
      const kind = candidate ? "repair" : "initial";
      if (kind === "repair") {
        if (repairs >= maxRepairAttempts) {
          return {
            attempts,
            error: {
              code: "validation_failed",
              message: "The itinerary remained infeasible after bounded repair.",
              retryable: false,
            },
            repairAttempts: repairs,
            status: "error",
          };
        }
        repairs += 1;
        await rawInput.onStage?.("repairing");
      } else {
        await rawInput.onStage?.("generating");
      }

      const result = await this.gateway.generateItinerary({
        prompt:
          kind === "initial"
            ? generationPrompt(request, groundingContext)
            : repairPrompt(request, groundingContext, candidate!, validation!),
        promptVersion,
        requestId: rawInput.requestId,
        signal: rawInput.signal,
        system: this.system,
        timeoutMs: this.timeoutMs,
      });
      const baseAudit = {
        attemptNumber: attemptOffset + attempts.length + 1,
        cost: result.metadata.cost,
        durationMs: result.metadata.durationMs,
        generationId: result.metadata.generationId,
        kind,
        model: result.metadata.model,
        promptVersion: result.metadata.promptVersion,
        provider: result.metadata.provider,
        repairNumber: kind === "repair" ? repairs : null,
        usage: result.metadata.usage,
      } as const;

      if (result.status === "error") {
        const audit: ItineraryGenerationAttemptAudit = {
          ...baseAudit,
          issueCodes: [`gateway.${result.error.code}`],
          outcome: "provider_error",
        };
        attempts.push(audit);
        await rawInput.onAttempt?.(audit);
        return {
          attempts,
          error: {
            code: "provider_failure",
            gatewayError: result.error,
            message: result.error.message,
            retryable: result.error.retryable,
          },
          repairAttempts: repairs,
          status: "error",
        };
      }

      candidate = result.output;
      await rawInput.onStage?.("validating");
      validation = validateItineraryCandidate({ candidate, groundingContext, request });
      const audit: ItineraryGenerationAttemptAudit = {
        ...baseAudit,
        issueCodes: validation.issues.map(({ code }) => code).toSorted(),
        outcome: validation.valid ? "accepted" : "rejected",
      };
      attempts.push(audit);
      await rawInput.onAttempt?.(audit);

      if (validation.valid) {
        const draft = withValidationWarnings(candidate, validation);
        return {
          attempts,
          draft,
          overallConfidence: itineraryOverallConfidence(draft),
          repairAttempts: repairs,
          status: "success",
          validation,
        };
      }
    }
  }
}
