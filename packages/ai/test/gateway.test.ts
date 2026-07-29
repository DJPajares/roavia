import { describe, expect, test } from "vitest";

import { AiGateway, type AiTelemetryEvent } from "../src/index.js";
import {
  FixtureAiProvider,
  assistantOutputV1Fixture,
  itineraryOutputV1Fixture,
} from "../src/testing.js";

function successfulProvider(value: unknown = itineraryOutputV1Fixture) {
  return new FixtureAiProvider({
    model: "fixture-structured-v1",
    provider: "fixture",
    steps: [
      {
        result: {
          cost: { amountMicros: 250, currency: "USD" },
          finishReason: "stop",
          safety: { blocked: false },
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
          value,
        },
      },
    ],
  });
}

describe("provider-neutral AI gateway", () => {
  test("validates itinerary output and emits content-free operational telemetry", async () => {
    const provider = successfulProvider();
    const events: AiTelemetryEvent[] = [];
    const gateway = new AiGateway(provider, {
      telemetry: (event) => {
        events.push(event);
      },
    });
    const sensitivePrompt = "Plan Tokyo for 2026-10-10 from a private home address.";

    const result = await gateway.generateItinerary({
      prompt: sensitivePrompt,
      promptVersion: "itinerary-v1",
      requestId: "request-1",
    });

    expect(result.status).toBe("success");
    expect(result.status === "success" && result.output).toEqual(itineraryOutputV1Fixture);
    expect(result.metadata).toMatchObject({
      cost: { amountMicros: 250, currency: "USD" },
      finishReason: "stop",
      generationId: expect.any(String),
      model: "fixture-structured-v1",
      operation: "itinerary",
      promptVersion: "itinerary-v1",
      provider: "fixture",
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });
    expect(provider.calls).toEqual([
      {
        operation: "itinerary",
        promptVersion: "itinerary-v1",
        schemaName: "RoaviaItineraryV1",
      },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      generationId: result.metadata.generationId,
      model: "fixture-structured-v1",
      outcome: "success",
      provider: "fixture",
      requestId: "request-1",
    });
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(sensitivePrompt);
    expect(serialized).not.toContain("Tokyo");
    expect(serialized).not.toContain("2026-10-10");
    expect(serialized).not.toContain("private home address");
  });

  test("validates assistant output through its independent schema contract", async () => {
    const gateway = new AiGateway(successfulProvider(assistantOutputV1Fixture));

    const result = await gateway.generateAssistant({
      prompt: "Give a grounded answer.",
      promptVersion: "assistant-v1",
    });

    expect(result.status).toBe("success");
    expect(result.status === "success" && result.output.schemaVersion).toBe("roavia.assistant.v1");
  });

  test("rejects invalid structured output even when an adapter reports success", async () => {
    const gateway = new AiGateway(
      successfulProvider({ ...itineraryOutputV1Fixture, unexpected: "provider-field" }),
    );

    const result = await gateway.generateItinerary({
      prompt: "Generate an itinerary.",
      promptVersion: "itinerary-v1",
    });

    expect(result.status).toBe("error");
    expect(result.status === "error" && result.error).toEqual({
      code: "invalid_output",
      message: "AI output did not satisfy the required schema.",
      retryable: true,
    });
  });

  test("turns a hanging provider into a bounded timeout", async () => {
    const provider = new FixtureAiProvider({ steps: [{ waitForAbort: true }] });
    const gateway = new AiGateway(provider, { defaultTimeoutMs: 5 });

    const result = await gateway.generateItinerary({
      prompt: "Generate an itinerary.",
      promptVersion: "itinerary-v1",
    });

    expect(result.status).toBe("error");
    expect(result.status === "error" && result.error).toEqual({
      code: "timeout",
      message: "AI generation exceeded its execution timeout.",
      retryable: true,
    });
    expect(provider.calls).toHaveLength(1);
  });

  test.each([
    ["rate_limited", true, "rate_limited"],
    ["unavailable", true, "provider_unavailable"],
    ["safety_refusal", false, "safety_refusal"],
  ] as const)("normalizes %s provider failures as %s", async (providerCode, retryable, code) => {
    const provider = new FixtureAiProvider({
      steps: [{ error: { code: providerCode, retryable } }],
    });
    const gateway = new AiGateway(provider);

    const result = await gateway.generateAssistant({
      prompt: "Answer a question.",
      promptVersion: "assistant-v1",
    });

    expect(result.status).toBe("error");
    expect(result.status === "error" && result.error.code).toBe(code);
    expect(result.status === "error" && result.error.retryable).toBe(retryable);
  });

  test("normalizes safety metadata and unexpected adapter exceptions", async () => {
    const refusal = successfulProvider(assistantOutputV1Fixture);
    const refusalStep = new FixtureAiProvider({
      steps: [
        {
          result: {
            finishReason: "content-filter",
            safety: { blocked: true, category: "content-filter" },
            value: assistantOutputV1Fixture,
          },
        },
      ],
    });
    const refused = await new AiGateway(refusalStep).generateAssistant({
      prompt: "Answer a question.",
      promptVersion: "assistant-v1",
    });
    expect(refused.status === "error" && refused.error.code).toBe("safety_refusal");

    const broken = new FixtureAiProvider({
      steps: [{ throw: new Error("raw provider secret and response") }],
    });
    const failed = await new AiGateway(broken).generateItinerary({
      prompt: "Generate an itinerary.",
      promptVersion: "itinerary-v1",
    });
    expect(failed.status === "error" && failed.error).toEqual({
      code: "internal",
      message: "AI generation failed unexpectedly.",
      retryable: false,
    });
    expect(JSON.stringify(failed)).not.toContain("raw provider secret");
    expect(refusal.calls).toHaveLength(0);
  });

  test("normalizes a schema-valid structured refusal", async () => {
    const structuredRefusal = {
      ...assistantOutputV1Fixture,
      claims: [],
      safety: {
        ...assistantOutputV1Fixture.safety,
        classification: "refusal" as const,
      },
      sources: [],
      suggestedActions: [],
    };
    const result = await new AiGateway(successfulProvider(structuredRefusal)).generateAssistant({
      prompt: "Answer a question.",
      promptVersion: "assistant-v1",
    });

    expect(result.status === "error" && result.error.code).toBe("safety_refusal");
    expect(result.metadata.safety).toEqual({
      blocked: true,
      category: "structured-refusal",
    });
  });

  test("does not let telemetry failures alter a valid generation", async () => {
    const gateway = new AiGateway(successfulProvider(), {
      telemetry: () => {
        throw new Error("telemetry unavailable");
      },
    });

    const result = await gateway.generateItinerary({
      prompt: "Generate an itinerary.",
      promptVersion: "itinerary-v1",
    });

    expect(result.status).toBe("success");
  });

  test("rejects invalid prompt metadata before calling a provider", async () => {
    const provider = successfulProvider();
    const gateway = new AiGateway(provider);

    const result = await gateway.generateItinerary({
      prompt: "   ",
      promptVersion: "contains spaces",
    });

    expect(result.status === "error" && result.error.code).toBe("invalid_request");
    expect(provider.calls).toHaveLength(0);

    const invalidTimeout = await gateway.generateItinerary({
      prompt: "Generate an itinerary.",
      promptVersion: "itinerary-v1",
      timeoutMs: 0,
    });
    expect(invalidTimeout.status === "error" && invalidTimeout.error.code).toBe("invalid_request");
    expect(provider.calls).toHaveLength(0);
  });
});
