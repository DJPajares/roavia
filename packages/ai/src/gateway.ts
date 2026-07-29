import type { z } from "zod";

import {
  type AiGatewayError,
  type AiGatewayErrorCode,
  type AiGatewayMetadata,
  type AiGatewayResult,
  type AiGenerationRequest,
  type AiOperation,
  type AiProviderAdapter,
  type AiProviderError,
  type AiProviderResult,
  type AiTelemetryEvent,
  type AiTelemetrySink,
} from "./contracts.js";
import {
  assistantOutputV1Schema,
  type AssistantOutputV1,
  itineraryOutputV1Schema,
  type ItineraryOutputV1,
  tripIntentOutputV1Schema,
  type TripIntentOutputV1,
} from "./schemas.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const promptVersionPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;

const gatewayMessages: Record<AiGatewayErrorCode, string> = {
  cancelled: "AI generation was cancelled.",
  internal: "AI generation failed unexpectedly.",
  invalid_output: "AI output did not satisfy the required schema.",
  invalid_request: "AI generation request was invalid.",
  provider_unavailable: "AI provider is temporarily unavailable.",
  quota_exhausted: "AI provider quota is exhausted.",
  rate_limited: "AI provider rate limit was reached.",
  safety_refusal: "AI provider declined the request for safety reasons.",
  timeout: "AI generation exceeded its execution timeout.",
  unauthorized: "AI provider credentials were rejected.",
};

function normalizeProviderError(error: AiProviderError): AiGatewayError {
  const code: AiGatewayErrorCode =
    error.code === "invalid_response"
      ? "invalid_output"
      : error.code === "unavailable"
        ? "provider_unavailable"
        : error.code;
  return {
    code,
    message: gatewayMessages[code],
    retryAfterMs: error.retryAfterMs,
    retryable: error.retryable,
  };
}

function gatewayError(code: AiGatewayErrorCode, retryable: boolean): AiGatewayError {
  return { code, message: gatewayMessages[code], retryable };
}

interface AiGatewayOptions {
  clock?: () => Date;
  defaultTimeoutMs?: number;
  telemetry?: AiTelemetrySink;
}

interface GenerationDefinition<TOutput> {
  isSafetyRefusal?: (output: TOutput) => boolean;
  operation: AiOperation;
  schema: z.ZodType<TOutput>;
  schemaDescription: string;
  schemaName: string;
}

export class AiGateway {
  private readonly adapter: AiProviderAdapter;
  private readonly clock: () => Date;
  private readonly defaultTimeoutMs: number;
  private readonly telemetry?: AiTelemetrySink;

  constructor(adapter: AiProviderAdapter, options: AiGatewayOptions = {}) {
    this.adapter = adapter;
    this.clock = options.clock ?? (() => new Date());
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.telemetry = options.telemetry;
    this.assertTimeout(this.defaultTimeoutMs);
  }

  generateItinerary(input: AiGenerationRequest): Promise<AiGatewayResult<ItineraryOutputV1>> {
    return this.generate(input, {
      operation: "itinerary",
      schema: itineraryOutputV1Schema,
      schemaDescription: "A strict, source-aware Roavia itinerary candidate.",
      schemaName: "RoaviaItineraryV1",
    });
  }

  generateAssistant(input: AiGenerationRequest): Promise<AiGatewayResult<AssistantOutputV1>> {
    return this.generate(input, {
      operation: "assistant",
      isSafetyRefusal: (output) => output.safety.classification === "refusal",
      schema: assistantOutputV1Schema,
      schemaDescription: "A strict, source-aware Roavia assistant response.",
      schemaName: "RoaviaAssistantV1",
    });
  }

  generateTripIntent(input: AiGenerationRequest): Promise<AiGatewayResult<TripIntentOutputV1>> {
    return this.generate(input, {
      operation: "trip_intent",
      schema: tripIntentOutputV1Schema,
      schemaDescription:
        "A strict Roavia trip intent containing only facts and explicit assumptions from the traveler prompt.",
      schemaName: "RoaviaTripIntentV1",
    });
  }

  private isValidTimeout(timeoutMs: number) {
    return Number.isInteger(timeoutMs) && timeoutMs >= 1;
  }

  private assertTimeout(timeoutMs: number) {
    if (!this.isValidTimeout(timeoutMs)) {
      throw new Error("AI gateway timeoutMs must be a positive integer.");
    }
  }

  private async generate<TOutput>(
    input: AiGenerationRequest,
    definition: GenerationDefinition<TOutput>,
  ): Promise<AiGatewayResult<TOutput>> {
    const startedAt = this.clock();
    const timeoutMs = input.timeoutMs ?? this.defaultTimeoutMs;
    if (
      !this.isValidTimeout(timeoutMs) ||
      input.prompt.trim().length === 0 ||
      !promptVersionPattern.test(input.promptVersion)
    ) {
      return this.failure(
        gatewayError("invalid_request", false),
        definition.operation,
        input,
        startedAt,
      );
    }

    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort(input.signal?.reason);
    if (input.signal?.aborted) cancel();
    else input.signal?.addEventListener("abort", cancel, { once: true });

    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("AI gateway timeout", "TimeoutError"));
    }, timeoutMs);

    const cancellation = new Promise<AiProviderResult<TOutput>>((resolve) => {
      const cancelledResult = (): void => {
        resolve({
          error: {
            code: timedOut ? "timeout" : "cancelled",
            retryable: timedOut,
          },
          status: "error",
        });
      };
      if (controller.signal.aborted) cancelledResult();
      else controller.signal.addEventListener("abort", cancelledResult, { once: true });
    });

    let providerResult: AiProviderResult<TOutput>;
    try {
      providerResult = await Promise.race([
        this.adapter.generate({
          operation: definition.operation,
          prompt: input.prompt,
          promptVersion: input.promptVersion,
          schema: definition.schema,
          schemaDescription: definition.schemaDescription,
          schemaName: definition.schemaName,
          signal: controller.signal,
          system: input.system,
        }),
        cancellation,
      ]);
    } catch {
      providerResult = {
        error: { code: "internal", retryable: false },
        status: "error",
      };
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", cancel);
    }

    if (providerResult.status === "error") {
      return this.failure(
        normalizeProviderError(providerResult.error),
        definition.operation,
        input,
        startedAt,
        providerResult,
      );
    }

    if (providerResult.safety?.blocked || providerResult.finishReason === "content-filter") {
      return this.failure(
        gatewayError("safety_refusal", false),
        definition.operation,
        input,
        startedAt,
        providerResult,
      );
    }

    const parsed = definition.schema.safeParse(providerResult.value);
    if (!parsed.success) {
      return this.failure(
        gatewayError("invalid_output", true),
        definition.operation,
        input,
        startedAt,
        providerResult,
      );
    }

    if (definition.isSafetyRefusal?.(parsed.data)) {
      return this.failure(
        gatewayError("safety_refusal", false),
        definition.operation,
        input,
        startedAt,
        {
          ...providerResult,
          safety: { blocked: true, category: "structured-refusal" },
        },
      );
    }

    const metadata = this.metadata(definition.operation, input, startedAt, providerResult);
    const result: AiGatewayResult<TOutput> = {
      metadata,
      output: parsed.data,
      status: "success",
    };
    this.emit({
      ...metadata,
      outcome: "success",
      requestId: input.requestId,
      timestamp: this.clock().toISOString(),
    });
    return result;
  }

  private failure(
    error: AiGatewayError,
    operation: AiOperation,
    input: AiGenerationRequest,
    startedAt: Date,
    providerResult?: AiProviderResult<unknown>,
  ): AiGatewayResult<never> {
    const metadata = this.metadata(operation, input, startedAt, providerResult);
    this.emit({
      ...metadata,
      errorCode: error.code,
      outcome: "error",
      requestId: input.requestId,
      timestamp: this.clock().toISOString(),
    });
    return { error, metadata, status: "error" };
  }

  private metadata(
    operation: AiOperation,
    input: AiGenerationRequest,
    startedAt: Date,
    providerResult?: AiProviderResult<unknown>,
  ): AiGatewayMetadata {
    return {
      cost: providerResult?.cost,
      durationMs: Math.max(0, this.clock().getTime() - startedAt.getTime()),
      finishReason: providerResult?.finishReason,
      model: this.adapter.model,
      operation,
      promptVersion: input.promptVersion,
      provider: this.adapter.provider,
      safety: providerResult?.safety,
      usage: providerResult?.usage,
    };
  }

  private emit(event: AiTelemetryEvent) {
    if (!this.telemetry) return;
    try {
      const pending = this.telemetry(event);
      if (pending instanceof Promise) void pending.catch(() => undefined);
    } catch {
      // Telemetry must never change a product result.
    }
  }
}
