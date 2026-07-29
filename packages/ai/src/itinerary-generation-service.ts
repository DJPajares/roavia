import type { GroundingContext } from "./grounding.js";
import { GroundingRetriever } from "./grounding.js";
import {
  ItineraryGenerationEngine,
  type ItineraryGenerationAttemptAudit,
  type ItineraryGenerationResult,
  type ItineraryGenerationSuccess,
  type NormalizedItineraryGenerationRequest,
} from "./itinerary-generation.js";

export type ItineraryGenerationRunStage =
  "queued" | "retrieving" | "generating" | "validating" | "repairing" | "persisting";

export interface ItineraryGenerationRunSnapshot {
  attemptCount: number;
  maxRepairAttempts: number;
  promptVersion: string;
  repairAttempts: number;
  request: NormalizedItineraryGenerationRequest;
  runId: string;
  tripId: string;
  tripRevision: number;
}

export interface ItineraryGenerationRunFailure {
  cancelled: boolean;
  code: string;
  terminal: boolean;
}

export interface ItineraryGenerationStore {
  begin(
    runId: string,
    expected: { tripId: string; tripRevision: number },
  ): Promise<ItineraryGenerationRunSnapshot>;
  finishFailure(runId: string, failure: ItineraryGenerationRunFailure): Promise<void>;
  persistSuccess(
    run: ItineraryGenerationRunSnapshot,
    result: ItineraryGenerationSuccess,
    groundingContext: GroundingContext,
  ): Promise<void>;
  recordAttempt(runId: string, attempt: ItineraryGenerationAttemptAudit): Promise<void>;
  recordGrounding(runId: string, groundingContext: GroundingContext): Promise<void>;
  setStage(
    runId: string,
    stage: Exclude<ItineraryGenerationRunStage, "queued" | "retrieving">,
  ): Promise<void>;
}

export interface ItineraryGenerationServiceInput {
  jobAttempt?: number;
  maxJobAttempts?: number;
  requestId?: string;
  runId: string;
  signal?: AbortSignal;
  tripId: string;
  tripRevision: number;
}

export type ItineraryGenerationServiceResult =
  | ItineraryGenerationResult
  | {
      attempts: [];
      error: {
        code: "grounding_unavailable";
        message: string;
        retryable: false;
      };
      repairAttempts: number;
      status: "error";
    };

function retrievalQuery(request: NormalizedItineraryGenerationRequest): string {
  const parts = [
    request.destinations.map(({ name }) => name).join(", "),
    request.interests.join(", "),
    request.mustDo.join(", "),
    request.dietaryNeeds.join(", "),
    request.accessibilityNeeds.join(", "),
    "places practical guidance routes seasonality availability accessibility",
  ];
  return parts.filter(Boolean).join(" — ").slice(0, 1_000);
}

function tripConstraints(request: NormalizedItineraryGenerationRequest): string[] {
  return [
    ...request.dietaryNeeds.map((value) => `Dietary: ${value}`),
    ...request.accessibilityNeeds.map((value) => `Accessibility: ${value}`),
    ...request.mustDo.map((value) => `Must do: ${value}`),
    ...request.mustAvoid.map((value) => `Must avoid: ${value}`),
    `Maximum transfers per day: ${request.maxTransfersPerDay}`,
    `Maximum transfer duration: ${request.maxTransferMinutes} minutes`,
  ].slice(0, 20);
}

/** Coordinates retrieval, in-memory generation/repair, and validated persistence. */
export class ItineraryGenerationService {
  private readonly engine: ItineraryGenerationEngine;
  private readonly retriever: GroundingRetriever;
  private readonly store: ItineraryGenerationStore;

  constructor(input: {
    engine: ItineraryGenerationEngine;
    retriever: GroundingRetriever;
    store: ItineraryGenerationStore;
  }) {
    this.engine = input.engine;
    this.retriever = input.retriever;
    this.store = input.store;
  }

  async generate(
    input: ItineraryGenerationServiceInput,
  ): Promise<ItineraryGenerationServiceResult> {
    const run = await this.store.begin(input.runId, {
      tripId: input.tripId,
      tripRevision: input.tripRevision,
    });
    let groundingContext: GroundingContext;
    try {
      groundingContext = await this.retriever.retrieve({
        destinationIds: run.request.destinations.map(({ placeId }) => placeId),
        locale: run.request.locale,
        purpose: "itinerary",
        query: retrievalQuery(run.request),
        requiredKinds: ["place", "practical", "seasonality", "route"],
        tripContext: {
          budgetStyle: run.request.budget.style,
          constraints: tripConstraints(run.request),
          dateWindow: { endDate: run.request.endDate, startDate: run.request.startDate },
          destinationNames: run.request.destinations.map(({ name }) => name),
          interests: run.request.interests,
          pace: run.request.pace,
          title: run.request.title,
        },
      });
      await this.store.recordGrounding(run.runId, groundingContext);
    } catch (error) {
      await this.store.finishFailure(run.runId, {
        cancelled: input.signal?.aborted ?? false,
        code: input.signal?.aborted ? "cancelled" : "grounding_failed",
        terminal: !(input.signal?.aborted ?? false),
      });
      throw error;
    }

    if (groundingContext.status === "empty") {
      const failure = {
        attempts: [] as [],
        error: {
          code: "grounding_unavailable" as const,
          message: "No source-backed grounding evidence was available for itinerary generation.",
          retryable: false as const,
        },
        repairAttempts: run.repairAttempts,
        status: "error" as const,
      };
      await this.store.finishFailure(run.runId, {
        cancelled: false,
        code: failure.error.code,
        terminal: true,
      });
      return failure;
    }

    const result = await this.engine.generate({
      attemptOffset: run.attemptCount,
      groundingContext,
      maxRepairAttempts: run.maxRepairAttempts,
      onAttempt: (attempt) => this.store.recordAttempt(run.runId, attempt),
      onStage: (stage) => this.store.setStage(run.runId, stage),
      promptVersion: run.promptVersion,
      repairOffset: run.repairAttempts,
      request: run.request,
      requestId: input.requestId,
      signal: input.signal,
    });

    if (result.status === "success") {
      await this.store.setStage(run.runId, "persisting");
      await this.store.persistSuccess(run, result, groundingContext);
      return result;
    }

    const cancelled = result.error.gatewayError?.code === "cancelled";
    const maxJobAttempts = input.maxJobAttempts ?? 1;
    const jobAttempt = input.jobAttempt ?? 1;
    const terminal = cancelled || !result.error.retryable || jobAttempt >= maxJobAttempts;
    await this.store.finishFailure(run.runId, {
      cancelled,
      code: result.error.gatewayError?.code ?? result.error.code,
      terminal,
    });
    return result;
  }
}
