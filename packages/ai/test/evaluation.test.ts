import { describe, expect, test } from "vitest";

import {
  AiEvaluationThresholdError,
  AiGateway,
  GroundedAssistantService,
  GroundingRetriever,
  ItineraryGenerationEngine,
  assertAiEvaluationThresholds,
  compareAiEvaluationReports,
  normalizeItineraryGenerationRequest,
  runAiEvaluationSuite,
  validateItineraryCandidate,
  type AiEvaluationCase,
  type AssistantOutputV1,
  type GroundingContext,
  type ItineraryOutputV1,
  type NormalizedItineraryGenerationRequest,
} from "../src/index.js";
import {
  FixtureAiProvider,
  FixtureGroundingDataSource,
  groundingCandidateFixture,
  officialGroundingSourceFixture,
} from "../src/testing.js";

const TRIP_ID = "10000000-0000-4000-8000-000000000001";
const PLACE_ID = "20000000-0000-4000-8000-000000000001";
const SECOND_PLACE_ID = "20000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-07-29T00:00:00.000Z");
const SUITE_ID = "roavia-ai-quality";
const SUITE_VERSION = "v1";

const outputSource = {
  official: officialGroundingSourceFixture.official,
  retrievedAt: officialGroundingSourceFixture.retrievedAt,
  sourceId: officialGroundingSourceFixture.sourceId,
  title: officialGroundingSourceFixture.title,
  url: officialGroundingSourceFixture.url,
  validUntil: officialGroundingSourceFixture.validUntil,
};

function request(
  overrides: Partial<NormalizedItineraryGenerationRequest> = {},
): NormalizedItineraryGenerationRequest {
  return normalizeItineraryGenerationRequest({
    accessibilityNeeds: [],
    budget: { amountMinor: null, currency: "USD", style: "midrange" },
    destinations: [{ name: "Fixture City", placeId: PLACE_ID, timezone: "Etc/UTC" }],
    dietaryNeeds: [],
    endDate: "2030-01-03",
    interests: ["architecture"],
    locale: "en",
    maxTransferMinutes: 120,
    maxTransfersPerDay: 4,
    mustAvoid: [],
    mustDo: [],
    pace: "balanced",
    startDate: "2030-01-01",
    title: "Versioned evaluation fixture",
    travelers: { adults: 2, children: 0, infants: 0 },
    tripId: TRIP_ID,
    tripRevision: 2,
    ...overrides,
  });
}

async function context(
  facts: Array<{ key: string; value: string }> = [
    { key: "availability", value: "open" },
    { key: "accessibility", value: "accessible" },
  ],
): Promise<GroundingContext> {
  return new GroundingRetriever([
    new FixtureGroundingDataSource({
      candidates: [
        groundingCandidateFixture({
          candidateId: "fixture-place",
          destinationIds: [PLACE_ID],
          facts,
          kind: "place",
          title: "Versioned place evidence",
        }),
      ],
    }),
  ]).retrieve(
    {
      destinationIds: [PLACE_ID],
      purpose: "itinerary",
      query: "versioned place evidence",
      requiredKinds: ["place"],
    },
    NOW,
  );
}

function item(
  candidateId: string,
  placeId = PLACE_ID,
  overrides: Partial<ItineraryOutputV1["days"][number]["items"][number]> = {},
): ItineraryOutputV1["days"][number]["items"][number] {
  return {
    booking: { required: false, status: "not_needed", url: null },
    candidateId,
    confidence: { explanation: "Supported by deterministic fixture evidence.", level: "high" },
    durationMinutes: 90,
    endTime: "10:30",
    estimatedCost: null,
    itemType: "activity",
    notes: null,
    place: { address: null, name: "Fixture place", placeId },
    sourceIds: [outputSource.sourceId],
    startTime: "09:00",
    title: "Fixture activity",
    ...overrides,
  };
}

function output(
  items: ItineraryOutputV1["days"][number]["items"],
  overrides: Partial<ItineraryOutputV1> = {},
): ItineraryOutputV1 {
  return {
    assumptions: [],
    days: [
      {
        candidateId: "fixture-day",
        items,
        localDate: "2030-01-01",
        notes: null,
        timezone: "Etc/UTC",
        title: "Fixture day",
      },
    ],
    schemaVersion: "roavia.itinerary.v1",
    sources: [outputSource],
    title: "Versioned evaluation fixture",
    warnings: [],
    ...overrides,
  };
}

function observation(scores: Record<string, number>, durationMs = 10) {
  return {
    durationMs,
    estimatedCostMicros: 100,
    failureCodes: [],
    scores,
  };
}

function assistantOutput(): AssistantOutputV1 {
  return {
    answer: "The source-backed fixture supports this general recommendation.",
    claims: [
      {
        claimId: "fixture-claim",
        confidence: { explanation: "The fixture is source-backed.", level: "high" },
        sourceIds: [outputSource.sourceId],
        text: "The recommendation is supported by the approved fixture source.",
      },
    ],
    safety: {
      classification: "general",
      explanation: "This is general travel guidance.",
      officialSourceRequired: false,
    },
    schemaVersion: "roavia.assistant.v1",
    sources: [outputSource],
    suggestedActions: [],
    uncertainty: { explanation: "Conditions can change.", level: "medium" },
  };
}

function deterministicCases(): AiEvaluationCase[] {
  return [
    {
      caseId: "feasible-relevant-grounded-itinerary",
      caseVersion: "v1",
      dimensions: ["feasibility", "relevance", "grounding"],
      evaluate: async () => {
        const candidate = output([item("activity-1")]);
        const validation = validateItineraryCandidate({
          candidate,
          groundingContext: await context(),
          request: request(),
        });
        return observation({
          feasibility: validation.valid ? 1 : 0,
          grounding: validation.issues.some(({ code }) => code === "unsupported_source") ? 0 : 1,
          relevance: validation.issues.some(({ code }) => code === "unsupported_place") ? 0 : 1,
        });
      },
    },
    {
      caseId: "budget-conflict-detection",
      caseVersion: "v1",
      dimensions: ["budget"],
      evaluate: async () => {
        const validation = validateItineraryCandidate({
          candidate: output([
            item("activity-1", PLACE_ID, {
              estimatedCost: { currencyCode: "USD", maximumAmount: 90, minimumAmount: 80 },
            }),
          ]),
          groundingContext: await context(),
          request: request({
            budget: { amountMinor: 5_000, currency: "USD", style: "budget" },
          }),
        });
        return observation({
          budget: validation.blockingIssues.some(({ code }) => code === "budget_conflict") ? 1 : 0,
        });
      },
    },
    {
      caseId: "family-accessibility-conflict-detection",
      caseVersion: "v1",
      dimensions: ["family_accessibility"],
      evaluate: async () => {
        const normalized = request({
          accessibilityNeeds: ["Step-free access"],
          travelers: { adults: 2, children: 2, infants: 0 },
        });
        const validation = validateItineraryCandidate({
          candidate: output([item("activity-1")]),
          groundingContext: await context([
            { key: "availability", value: "open" },
            { key: "accessibility", value: "inaccessible" },
          ]),
          request: normalized,
        });
        const protectsFamilyNeeds =
          normalized.travelers.children > 0 &&
          validation.blockingIssues.some(({ code }) => code === "accessibility_conflict");
        return observation({ family_accessibility: protectsFamilyNeeds ? 1 : 0 });
      },
    },
    {
      caseId: "seasonality-evidence-selection",
      caseVersion: "v1",
      dimensions: ["seasonality"],
      evaluate: async () => {
        const grounding = await new GroundingRetriever([
          new FixtureGroundingDataSource({
            candidates: [
              groundingCandidateFixture({
                candidateId: "seasonality-fixture",
                destinationIds: [PLACE_ID],
                kind: "seasonality",
                title: "Seasonality climate fixture",
              }),
            ],
          }),
        ]).retrieve(
          {
            destinationIds: [PLACE_ID],
            purpose: "assistant",
            query: "seasonality climate fixture",
            requiredKinds: ["seasonality"],
          },
          NOW,
        );
        return observation({
          seasonality:
            grounding.status === "complete" &&
            grounding.items.some(({ kind }) => kind === "seasonality")
              ? 1
              : 0,
        });
      },
    },
    {
      caseId: "unsupported-claim-rejection",
      caseVersion: "v1",
      dimensions: ["grounding", "unsupported_claims"],
      evaluate: async () => {
        const fabricatedSource = { ...outputSource, sourceId: "fabricated-source" };
        const validation = validateItineraryCandidate({
          candidate: output(
            [
              item("activity-1", SECOND_PLACE_ID, {
                sourceIds: [fabricatedSource.sourceId],
              }),
            ],
            { sources: [fabricatedSource] },
          ),
          groundingContext: await context(),
          request: request(),
        });
        const issueCodes = new Set(validation.blockingIssues.map(({ code }) => code));
        const rejected =
          issueCodes.has("unsupported_place") && issueCodes.has("unsupported_source");
        return observation({ grounding: rejected ? 1 : 0, unsupported_claims: rejected ? 1 : 0 });
      },
    },
    {
      caseId: "bounded-repair-quality",
      caseVersion: "v1",
      dimensions: ["repair_quality"],
      evaluate: async () => {
        const invalid = output([item("activity-1"), item("activity-2")]);
        const repaired = output([item("activity-1")]);
        const result = await new ItineraryGenerationEngine(
          new AiGateway(
            new FixtureAiProvider({
              steps: [{ result: { value: invalid } }, { result: { value: repaired } }],
            }),
          ),
        ).generate({ groundingContext: await context(), request: request() });
        const repairedCleanly =
          result.status === "success" &&
          result.repairAttempts === 1 &&
          result.attempts[0]?.outcome === "rejected" &&
          result.attempts[1]?.outcome === "accepted";
        return observation({ repair_quality: repairedCleanly ? 1 : 0 }, 20);
      },
    },
    {
      caseId: "assistant-sourced-answer",
      caseVersion: "v1",
      dimensions: ["grounding", "relevance"],
      evaluate: async () => {
        const service = new GroundedAssistantService(
          new AiGateway(
            new FixtureAiProvider({ steps: [{ result: { value: assistantOutput() } }] }),
          ),
          new GroundingRetriever([
            new FixtureGroundingDataSource({
              candidates: [
                groundingCandidateFixture({
                  candidateId: "assistant-fixture",
                  destinationIds: [PLACE_ID],
                  kind: "place",
                  title: "Assistant fixture evidence",
                }),
                groundingCandidateFixture({
                  candidateId: "assistant-practical-fixture",
                  destinationIds: [PLACE_ID],
                  kind: "practical",
                  title: "Assistant practical fixture evidence",
                }),
              ],
            }),
          ]),
        );
        const result = await service.answer({
          context: { destinationId: PLACE_ID, type: "destination" },
          locale: "en",
          question: "What should I prioritize from the approved fixture evidence?",
        });
        const sourced =
          result.answer.status === "answered" &&
          result.answer.claims.length > 0 &&
          result.answer.claims.every((claim) => claim.sourceIds.length > 0);
        return observation({ grounding: sourced ? 1 : 0, relevance: sourced ? 1 : 0 });
      },
    },
    {
      caseId: "assistant-high-stakes-fail-closed",
      caseVersion: "v1",
      dimensions: ["unsupported_claims"],
      evaluate: async () => {
        const unofficialSource = {
          ...officialGroundingSourceFixture,
          kind: "licensed_provider" as const,
          official: false,
          sourceId: "unofficial-source",
          trustTier: "tier_3" as const,
        };
        const service = new GroundedAssistantService(
          new AiGateway(
            new FixtureAiProvider({ steps: [{ result: { value: assistantOutput() } }] }),
          ),
          new GroundingRetriever([
            new FixtureGroundingDataSource({
              candidates: [
                groundingCandidateFixture({
                  authority: "licensed",
                  candidateId: "unofficial-practical-fixture",
                  destinationIds: [PLACE_ID],
                  kind: "practical",
                  sources: [unofficialSource],
                  title: "Unofficial practical fixture",
                }),
              ],
            }),
          ]),
        );
        const result = await service.answer({
          context: { destinationId: PLACE_ID, type: "destination" },
          locale: "en",
          question: "Which visa and medical requirements apply?",
        });
        const failedClosed =
          result.answer.status === "insufficient_evidence" && result.answer.claims.length === 0;
        return observation({ unsupported_claims: failedClosed ? 1 : 0 });
      },
    },
  ];
}

function clock() {
  let tick = 0;
  return () => new Date(NOW.getTime() + tick++);
}

describe("versioned AI evaluation release gate", () => {
  test("runs deterministic fixtures across every required quality dimension", async () => {
    const report = await runAiEvaluationSuite({
      cases: deterministicCases(),
      clock: clock(),
      createRunId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      model: "fixture-model-v1",
      promptVersion: "fixture-prompt-v1",
      provider: "fixture",
      suiteId: SUITE_ID,
      suiteVersion: SUITE_VERSION,
    });

    expect(report.passed).toBe(true);
    expect(report.summary.dimensionScores).toEqual({
      budget: 1,
      family_accessibility: 1,
      feasibility: 1,
      grounding: 1,
      relevance: 1,
      repair_quality: 1,
      seasonality: 1,
      unsupported_claims: 1,
    });
    expect(report.cases).toHaveLength(8);
    expect(() => assertAiEvaluationThresholds(report)).not.toThrow();
    expect(JSON.stringify(report)).not.toContain("2030-01-01");
    expect(JSON.stringify(report)).not.toContain("Fixture City");
  });

  test("fails the release gate when a required quality score regresses", async () => {
    const cases = deterministicCases();
    cases[0] = {
      ...cases[0]!,
      evaluate: () => observation({ feasibility: 0, grounding: 1, relevance: 1 }),
    };
    const report = await runAiEvaluationSuite({
      cases,
      clock: clock(),
      createRunId: () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      model: "fixture-model-v2",
      promptVersion: "fixture-prompt-v2",
      provider: "fixture",
      suiteId: SUITE_ID,
      suiteVersion: SUITE_VERSION,
    });

    expect(report.passed).toBe(false);
    expect(report.thresholdViolations).toContain("feasibility_below_threshold");
    expect(() => assertAiEvaluationThresholds(report)).toThrow(AiEvaluationThresholdError);
  });

  test("compares prompt and model versions without replacing either report", async () => {
    const baseline = await runAiEvaluationSuite({
      cases: deterministicCases(),
      clock: clock(),
      createRunId: () => "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      model: "fixture-model-v1",
      promptVersion: "fixture-prompt-v1",
      provider: "fixture",
      suiteId: SUITE_ID,
      suiteVersion: SUITE_VERSION,
    });
    const current = await runAiEvaluationSuite({
      cases: deterministicCases(),
      clock: clock(),
      createRunId: () => "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      model: "fixture-model-v2",
      promptVersion: "fixture-prompt-v2",
      provider: "fixture",
      suiteId: SUITE_ID,
      suiteVersion: SUITE_VERSION,
    });

    const comparison = compareAiEvaluationReports(baseline, current);
    expect(comparison).toMatchObject({
      baseline: { model: "fixture-model-v1", promptVersion: "fixture-prompt-v1" },
      current: { model: "fixture-model-v2", promptVersion: "fixture-prompt-v2" },
      overallScoreDelta: 0,
      totalEstimatedCostDeltaMicros: 0,
    });
    expect(baseline.runId).not.toBe(current.runId);
  });
});
