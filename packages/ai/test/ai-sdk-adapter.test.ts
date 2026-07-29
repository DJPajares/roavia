import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, test } from "vitest";

import { assistantOutputV1Schema } from "../src/index.js";
import {
  AiSdkAdapter,
  aiTokenPricingFromEnvironment,
  createAiCostCalculator,
} from "../src/server/index.js";
import { assistantOutputV1Fixture } from "../src/testing.js";

function mockModel(text: string, finishReason: "content-filter" | "stop" = "stop") {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: finishReason, raw: undefined },
      usage: {
        inputTokens: {
          total: 10,
          noCache: 10,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 20,
          text: 20,
          reasoning: undefined,
        },
      },
      warnings: [],
    }),
  });
}

function request() {
  return {
    operation: "assistant" as const,
    prompt: "Answer using the supplied context.",
    promptVersion: "assistant-v1",
    schema: assistantOutputV1Schema,
    schemaDescription: "A strict Roavia assistant response.",
    schemaName: "RoaviaAssistantV1",
    signal: new AbortController().signal,
  };
}

describe("AI SDK server adapter", () => {
  test("calculates micro-USD estimates from explicit current model pricing", () => {
    const calculate = createAiCostCalculator({
      inputUsdPerMillion: 2.5,
      outputUsdPerMillion: 10,
    });

    expect(calculate({ inputTokens: 10, outputTokens: 20, totalTokens: 30 })).toEqual({
      amountMicros: 225,
      currency: "USD",
    });
    expect(aiTokenPricingFromEnvironment({})).toBeUndefined();
    expect(() => aiTokenPricingFromEnvironment({ AI_INPUT_COST_PER_MILLION_USD: "2.5" })).toThrow(
      "required together",
    );
    expect(() =>
      createAiCostCalculator({ inputUsdPerMillion: -1, outputUsdPerMillion: 1 }),
    ).toThrow("non-negative");
  });

  test("generates and validates structured output without a live provider call", async () => {
    const adapter = new AiSdkAdapter({
      calculateCost: (tokenUsage) => ({
        amountMicros: tokenUsage.totalTokens ?? 0,
        currency: "USD",
      }),
      languageModel: mockModel(JSON.stringify(assistantOutputV1Fixture)),
      model: "fixture-model",
      provider: "fixture-provider",
    });

    const result = await adapter.generate(request());

    expect(result.status).toBe("success");
    expect(result.status === "success" && result.value).toEqual(assistantOutputV1Fixture);
    expect(result).toMatchObject({
      cost: { amountMicros: 30, currency: "USD" },
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    });
  });

  test("normalizes invalid JSON without exposing generated text", async () => {
    const rawInvalidOutput = "{not-valid-json containing sensitive model text";
    const adapter = new AiSdkAdapter({
      languageModel: mockModel(rawInvalidOutput),
      model: "fixture-model",
      provider: "fixture-provider",
    });

    const result = await adapter.generate(request());

    expect(result.status).toBe("error");
    expect(result.status === "error" && result.error).toEqual({
      code: "invalid_response",
      retryable: false,
    });
    expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 20, totalTokens: 30 });
    expect(JSON.stringify(result)).not.toContain(rawInvalidOutput);
  });

  test("normalizes content filtering as a safety refusal", async () => {
    const adapter = new AiSdkAdapter({
      languageModel: mockModel("", "content-filter"),
      model: "fixture-model",
      provider: "fixture-provider",
    });

    const result = await adapter.generate(request());

    expect(result.status === "error" && result.error.code).toBe("safety_refusal");
    expect(result.safety).toEqual({ blocked: true, category: "content-filter" });
  });
});
