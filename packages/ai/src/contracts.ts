import type { z } from "zod";

export type AiOperation = "assistant" | "itinerary" | "trip_intent";

export type AiFinishReason =
  "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other";

export interface AiTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AiCost {
  amountMicros: number;
  currency: "USD";
}

export interface AiSafetyMetadata {
  blocked: boolean;
  category?: string;
}

export type AiProviderErrorCode =
  | "cancelled"
  | "internal"
  | "invalid_request"
  | "invalid_response"
  | "quota_exhausted"
  | "rate_limited"
  | "safety_refusal"
  | "timeout"
  | "unauthorized"
  | "unavailable";

export interface AiProviderError {
  code: AiProviderErrorCode;
  retryAfterMs?: number;
  retryable: boolean;
}

interface AiProviderResultMetadata {
  cost?: AiCost;
  finishReason?: AiFinishReason;
  safety?: AiSafetyMetadata;
  usage?: AiTokenUsage;
}

export interface AiProviderSuccess<TOutput> extends AiProviderResultMetadata {
  status: "success";
  value: TOutput;
}

export interface AiProviderFailure extends AiProviderResultMetadata {
  error: AiProviderError;
  status: "error";
}

export type AiProviderResult<TOutput> = AiProviderFailure | AiProviderSuccess<TOutput>;

export interface AiProviderRequest<TOutput> {
  operation: AiOperation;
  prompt: string;
  promptVersion: string;
  schema: z.ZodType<TOutput>;
  schemaDescription: string;
  schemaName: string;
  signal: AbortSignal;
  system?: string;
}

/**
 * Provider credentials belong in a concrete server adapter constructor. They
 * are intentionally absent from this interface and from every gateway request.
 */
export interface AiProviderAdapter {
  readonly model: string;
  readonly provider: string;
  generate<TOutput>(request: AiProviderRequest<TOutput>): Promise<AiProviderResult<TOutput>>;
}

export type AiGatewayErrorCode =
  | "cancelled"
  | "internal"
  | "invalid_output"
  | "invalid_request"
  | "provider_unavailable"
  | "quota_exhausted"
  | "rate_limited"
  | "safety_refusal"
  | "timeout"
  | "unauthorized";

export interface AiGatewayError {
  code: AiGatewayErrorCode;
  message: string;
  retryAfterMs?: number;
  retryable: boolean;
}

export interface AiGenerationRequest {
  prompt: string;
  promptVersion: string;
  requestId?: string;
  signal?: AbortSignal;
  system?: string;
  timeoutMs?: number;
}

export interface AiGatewayMetadata {
  cost?: AiCost;
  durationMs: number;
  finishReason?: AiFinishReason;
  model: string;
  operation: AiOperation;
  promptVersion: string;
  provider: string;
  safety?: AiSafetyMetadata;
  usage?: AiTokenUsage;
}

export interface AiGatewaySuccess<TOutput> {
  metadata: AiGatewayMetadata;
  output: TOutput;
  status: "success";
}

export interface AiGatewayFailure {
  error: AiGatewayError;
  metadata: AiGatewayMetadata;
  status: "error";
}

export type AiGatewayResult<TOutput> = AiGatewayFailure | AiGatewaySuccess<TOutput>;

export type AiTelemetryOutcome = "error" | "success";

/**
 * Deliberately excludes prompts, responses, reasoning, dates, locations, user
 * or trip identifiers, and arbitrary metadata.
 */
export interface AiTelemetryEvent extends AiGatewayMetadata {
  errorCode?: AiGatewayErrorCode;
  outcome: AiTelemetryOutcome;
  requestId?: string;
  timestamp: string;
}

export type AiTelemetrySink = (event: AiTelemetryEvent) => Promise<void> | void;
