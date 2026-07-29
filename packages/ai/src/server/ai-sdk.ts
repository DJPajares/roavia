import {
  APICallError,
  createGateway,
  generateText,
  NoObjectGeneratedError,
  Output,
  type LanguageModel,
  type LanguageModelUsage,
} from "ai";

import type {
  AiCost,
  AiProviderAdapter,
  AiProviderErrorCode,
  AiProviderFailure,
  AiProviderRequest,
  AiProviderResult,
  AiTelemetrySink,
  AiTokenUsage,
} from "../contracts.js";
import { AiGateway } from "../gateway.js";

export interface AiSdkAdapterOptions {
  calculateCost?: (usage: AiTokenUsage) => AiCost | undefined;
  languageModel: LanguageModel;
  model: string;
  provider: string;
}

export interface AiTokenPricing {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

export function createAiCostCalculator(pricing: AiTokenPricing) {
  if (
    !Number.isFinite(pricing.inputUsdPerMillion) ||
    pricing.inputUsdPerMillion < 0 ||
    !Number.isFinite(pricing.outputUsdPerMillion) ||
    pricing.outputUsdPerMillion < 0
  ) {
    throw new RangeError("AI token pricing must use non-negative finite USD rates.");
  }
  return (tokenUsage: AiTokenUsage): AiCost | undefined => {
    if (tokenUsage.inputTokens === undefined && tokenUsage.outputTokens === undefined) {
      return undefined;
    }
    return {
      amountMicros: Math.round(
        (tokenUsage.inputTokens ?? 0) * pricing.inputUsdPerMillion +
          (tokenUsage.outputTokens ?? 0) * pricing.outputUsdPerMillion,
      ),
      currency: "USD",
    };
  };
}

export function aiTokenPricingFromEnvironment(
  environment: NodeJS.ProcessEnv,
): AiTokenPricing | undefined {
  const input = environment.AI_INPUT_COST_PER_MILLION_USD;
  const output = environment.AI_OUTPUT_COST_PER_MILLION_USD;
  if (input === undefined && output === undefined) return undefined;
  if (input === undefined || output === undefined) {
    throw new Error("Both AI input and output token pricing variables are required together.");
  }
  const pricing = {
    inputUsdPerMillion: Number(input),
    outputUsdPerMillion: Number(output),
  };
  createAiCostCalculator(pricing);
  return pricing;
}

export function createVercelGatewayAiGateway(input: {
  apiKey: string;
  model: string;
  pricing?: AiTokenPricing;
  telemetry?: AiTelemetrySink;
}) {
  if (!input.apiKey.trim() || !input.model.trim()) {
    throw new Error("Vercel AI Gateway requires an API key and model identifier.");
  }
  const provider = createGateway({ apiKey: input.apiKey });
  return new AiGateway(
    new AiSdkAdapter({
      calculateCost: input.pricing ? createAiCostCalculator(input.pricing) : undefined,
      languageModel: provider(input.model),
      model: input.model,
      provider: "vercel-gateway",
    }),
    { telemetry: input.telemetry },
  );
}

function usage(input: LanguageModelUsage | undefined): AiTokenUsage | undefined {
  if (!input) return undefined;
  return {
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    totalTokens: input.totalTokens,
  };
}

function failure(
  code: AiProviderErrorCode,
  retryable: boolean,
  metadata: Omit<AiProviderFailure, "error" | "status"> = {},
): AiProviderFailure {
  return { ...metadata, error: { code, retryable }, status: "error" };
}

function apiFailure(error: APICallError): AiProviderFailure {
  const status = error.statusCode;
  if (status === 408) return failure("timeout", true);
  if (status === 429) return failure("rate_limited", true);
  if (status === 401 || status === 403) return failure("unauthorized", false);
  if (status === 400 || status === 404 || status === 422) {
    return failure("invalid_request", false);
  }
  if ((status !== undefined && status >= 500) || error.isRetryable) {
    return failure("unavailable", true);
  }
  return failure("internal", false);
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

/**
 * Server-only bridge from a provider-neutral Roavia port to AI SDK Core. A
 * composition root supplies the concrete model and keeps its credentials out
 * of shared contracts and browser bundles.
 */
export class AiSdkAdapter implements AiProviderAdapter {
  readonly model: string;
  readonly provider: string;

  private readonly calculateCost?: AiSdkAdapterOptions["calculateCost"];
  private readonly languageModel: LanguageModel;

  constructor(options: AiSdkAdapterOptions) {
    if (options.model.trim().length === 0 || options.provider.trim().length === 0) {
      throw new Error("AI SDK adapter requires provider and model identifiers.");
    }
    this.calculateCost = options.calculateCost;
    this.languageModel = options.languageModel;
    this.model = options.model;
    this.provider = options.provider;
  }

  async generate<TOutput>(request: AiProviderRequest<TOutput>): Promise<AiProviderResult<TOutput>> {
    try {
      const result = await generateText({
        abortSignal: request.signal,
        maxRetries: 0,
        model: this.languageModel,
        output: Output.object({
          description: request.schemaDescription,
          name: request.schemaName,
          schema: request.schema,
        }),
        prompt: request.prompt,
        system: request.system,
      });
      const normalizedUsage = usage(result.usage);
      const resultMetadata = {
        cost: normalizedUsage ? this.calculateCost?.(normalizedUsage) : undefined,
        finishReason: result.finishReason,
        usage: normalizedUsage,
      };
      if (result.finishReason === "content-filter") {
        return failure("safety_refusal", false, {
          ...resultMetadata,
          safety: { blocked: true, category: "content-filter" },
        });
      }
      if (result.finishReason !== "stop") {
        return failure("invalid_response", true, resultMetadata);
      }
      return {
        ...resultMetadata,
        safety: { blocked: false },
        status: "success",
        value: result.output,
      };
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        const normalizedUsage = usage(error.usage);
        return failure(
          error.finishReason === "content-filter" ? "safety_refusal" : "invalid_response",
          false,
          {
            cost: normalizedUsage ? this.calculateCost?.(normalizedUsage) : undefined,
            finishReason: error.finishReason,
            safety:
              error.finishReason === "content-filter"
                ? { blocked: true, category: "content-filter" }
                : undefined,
            usage: normalizedUsage,
          },
        );
      }
      if (APICallError.isInstance(error)) return apiFailure(error);
      if (isAbortError(error)) return failure("cancelled", false);
      return failure("internal", false);
    }
  }
}
