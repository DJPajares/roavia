import type {
  AiProviderAdapter,
  AiProviderError,
  AiProviderRequest,
  AiProviderResult,
  AiProviderSuccess,
} from "./contracts.js";
import type {
  GroundingCandidate,
  GroundingDataSource,
  GroundingDataSourceResult,
  GroundingGapInput,
  GroundingKind,
  ResolvedGroundingRequest,
} from "./grounding.js";
import {
  ASSISTANT_OUTPUT_SCHEMA_VERSION,
  type AssistantOutputV1,
  ITINERARY_OUTPUT_SCHEMA_VERSION,
  type ItineraryOutputV1,
} from "./schemas.js";

export type FixtureAiProviderStep =
  | { error: AiProviderError }
  | { result: Omit<AiProviderSuccess<unknown>, "status"> }
  | { throw: unknown }
  | { waitForAbort: true };

export interface FixtureAiProviderCall {
  operation: AiProviderRequest<unknown>["operation"];
  promptVersion: string;
  schemaName: string;
}

/** Deterministic adapter for tests. It performs no network or quota-consuming calls. */
export class FixtureAiProvider implements AiProviderAdapter {
  readonly calls: FixtureAiProviderCall[] = [];
  readonly model: string;
  readonly provider: string;

  private cursor = 0;
  private readonly steps: readonly FixtureAiProviderStep[];

  constructor(input: {
    model?: string;
    provider?: string;
    steps: readonly FixtureAiProviderStep[];
  }) {
    if (input.steps.length === 0) throw new Error("Fixture providers require at least one step.");
    this.model = input.model ?? "fixture-model";
    this.provider = input.provider ?? "fixture-provider";
    this.steps = input.steps;
  }

  async generate<TOutput>(request: AiProviderRequest<TOutput>): Promise<AiProviderResult<TOutput>> {
    this.calls.push({
      operation: request.operation,
      promptVersion: request.promptVersion,
      schemaName: request.schemaName,
    });
    const step = this.steps[Math.min(this.cursor, this.steps.length - 1)]!;
    this.cursor += 1;

    if ("throw" in step) throw step.throw;
    if ("waitForAbort" in step) {
      return new Promise<AiProviderResult<TOutput>>((_, reject) => {
        if (request.signal.aborted) {
          reject(request.signal.reason ?? new DOMException("Aborted", "AbortError"));
          return;
        }
        request.signal.addEventListener(
          "abort",
          () => reject(request.signal.reason ?? new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    }
    if ("error" in step) return { error: step.error, status: "error" };
    return { ...step.result, status: "success", value: step.result.value as TOutput };
  }
}

export const itineraryOutputV1Fixture: ItineraryOutputV1 = {
  schemaVersion: ITINERARY_OUTPUT_SCHEMA_VERSION,
  title: "Tokyo city break",
  assumptions: [
    {
      code: "moderate-pace",
      summary: "The itinerary assumes a moderate walking pace.",
      needsConfirmation: true,
    },
  ],
  warnings: [],
  sources: [
    {
      sourceId: "source-tokyo-official",
      title: "Official Tokyo Travel Guide",
      url: "https://www.gotokyo.org/en/",
      retrievedAt: "2026-07-28T00:00:00.000Z",
      validUntil: null,
      official: true,
    },
  ],
  days: [
    {
      candidateId: "day-1",
      localDate: "2026-10-10",
      timezone: "Asia/Tokyo",
      title: "Historic Tokyo",
      notes: null,
      items: [
        {
          candidateId: "item-1",
          itemType: "activity",
          title: "Explore Asakusa",
          place: {
            placeId: "place-asakusa",
            name: "Asakusa",
            address: null,
          },
          startTime: "09:00",
          endTime: "11:00",
          durationMinutes: 120,
          estimatedCost: null,
          booking: {
            required: false,
            status: "not_needed",
            url: null,
          },
          notes: null,
          sourceIds: ["source-tokyo-official"],
          confidence: {
            level: "high",
            explanation: "The place is supported by the supplied official source.",
          },
        },
      ],
    },
  ],
};

export const assistantOutputV1Fixture: AssistantOutputV1 = {
  schemaVersion: ASSISTANT_OUTPUT_SCHEMA_VERSION,
  answer: "Asakusa is a practical morning stop for a first visit to Tokyo.",
  claims: [
    {
      claimId: "claim-1",
      text: "Asakusa is a practical morning stop.",
      sourceIds: ["source-tokyo-official"],
      confidence: {
        level: "medium",
        explanation: "The recommendation is grounded but depends on traveler preferences.",
      },
    },
  ],
  sources: itineraryOutputV1Fixture.sources,
  uncertainty: {
    level: "medium",
    explanation: "Crowd conditions can change by date and time.",
  },
  safety: {
    classification: "general",
    explanation: "This is general destination planning guidance.",
    officialSourceRequired: false,
  },
  suggestedActions: [
    {
      actionId: "action-1",
      kind: "add_place",
      summary: "Add Asakusa to the itinerary.",
      requiresConfirmation: true,
      parameters: { placeId: "place-asakusa" },
    },
  ],
};

export const officialGroundingSourceFixture: GroundingCandidate["sources"][number] = {
  attributionText: "Source: Singapore official tourism authority",
  kind: "official_authority",
  license: "official-site-terms",
  licenseUrl: "https://www.visitsingapore.com/terms-of-use/",
  official: true,
  provider: "visitsingapore",
  publishedAt: null,
  retrievedAt: "2026-07-28T00:00:00.000Z",
  sourceId: "source-singapore-official",
  title: "Visit Singapore",
  trustTier: "tier_1",
  url: "https://www.visitsingapore.com/",
  validFrom: null,
  validUntil: null,
};

export function groundingCandidateFixture(
  overrides: Partial<GroundingCandidate> &
    Pick<GroundingCandidate, "candidateId" | "kind" | "title">,
): GroundingCandidate {
  return {
    authority: "official",
    confidence: {
      explanation: "Deterministic, source-backed fixture evidence.",
      level: "high",
      score: 0.9,
    },
    content: `${overrides.title} is represented by deterministic fixture evidence.`,
    destinationIds: ["destination-singapore"],
    facts: [],
    freshness: {
      expiresAt: "2027-07-28T00:00:00.000Z",
      observedAt: "2026-07-28T00:00:00.000Z",
      staleAt: "2026-12-28T00:00:00.000Z",
      state: "fresh",
    },
    keywords: [],
    sources: [officialGroundingSourceFixture],
    ...overrides,
  };
}

export class FixtureGroundingDataSource implements GroundingDataSource {
  readonly calls: ResolvedGroundingRequest[] = [];
  readonly name: string;
  readonly supportedKinds: readonly GroundingKind[];

  private readonly candidates: readonly GroundingCandidate[];
  private readonly gaps: readonly GroundingGapInput[];
  private readonly rejection: unknown;

  constructor(input: {
    candidates?: readonly GroundingCandidate[];
    gaps?: readonly GroundingGapInput[];
    name?: string;
    rejection?: unknown;
    supportedKinds?: readonly GroundingKind[];
  }) {
    this.candidates = input.candidates ?? [];
    this.gaps = input.gaps ?? [];
    this.name = input.name ?? "fixture-grounding";
    this.rejection = input.rejection;
    this.supportedKinds = input.supportedKinds ?? ["place", "practical", "seasonality", "route"];
  }

  async retrieve(request: ResolvedGroundingRequest): Promise<GroundingDataSourceResult> {
    this.calls.push(request);
    if (this.rejection !== undefined) throw this.rejection;
    return { candidates: this.candidates, gaps: this.gaps };
  }
}
