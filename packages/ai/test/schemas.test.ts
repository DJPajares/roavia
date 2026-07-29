import { describe, expect, test } from "vitest";

import { assistantOutputV1Schema, itineraryOutputV1Schema } from "../src/index.js";
import { assistantOutputV1Fixture, itineraryOutputV1Fixture } from "../src/testing.js";

describe("versioned AI output schemas", () => {
  test("accepts deterministic itinerary and assistant fixtures", () => {
    expect(itineraryOutputV1Schema.parse(itineraryOutputV1Fixture)).toEqual(
      itineraryOutputV1Fixture,
    );
    expect(assistantOutputV1Schema.parse(assistantOutputV1Fixture)).toEqual(
      assistantOutputV1Fixture,
    );
  });

  test("rejects unknown keys at top-level and nested boundaries", () => {
    expect(
      itineraryOutputV1Schema.safeParse({
        ...itineraryOutputV1Fixture,
        providerPayload: { raw: true },
      }).success,
    ).toBe(false);

    const nested = structuredClone(itineraryOutputV1Fixture) as unknown as {
      days: Array<{ items: Array<Record<string, unknown>> }>;
    };
    nested.days[0]!.items[0]!.providerField = "not-allowed";
    expect(itineraryOutputV1Schema.safeParse(nested).success).toBe(false);
  });

  test("rejects unrecognized schema versions and unconfirmed assistant actions", () => {
    expect(
      itineraryOutputV1Schema.safeParse({
        ...itineraryOutputV1Fixture,
        schemaVersion: "roavia.itinerary.v2",
      }).success,
    ).toBe(false);

    const assistant = structuredClone(assistantOutputV1Fixture) as unknown as {
      suggestedActions: Array<{ requiresConfirmation: boolean }>;
    };
    assistant.suggestedActions[0]!.requiresConfirmation = false;
    expect(assistantOutputV1Schema.safeParse(assistant).success).toBe(false);
  });

  test("rejects ungrounded source references and missing official high-stakes sources", () => {
    const itinerary = structuredClone(itineraryOutputV1Fixture);
    itinerary.days[0]!.items[0]!.sourceIds = ["source-not-supplied"];
    expect(itineraryOutputV1Schema.safeParse(itinerary).success).toBe(false);

    const assistant = structuredClone(assistantOutputV1Fixture);
    assistant.safety.classification = "high_stakes";
    assistant.safety.officialSourceRequired = true;
    assistant.sources[0]!.official = false;
    expect(assistantOutputV1Schema.safeParse(assistant).success).toBe(false);

    expect(
      assistantOutputV1Schema.safeParse({
        ...assistantOutputV1Fixture,
        safety: { ...assistantOutputV1Fixture.safety, classification: "refusal" },
      }).success,
    ).toBe(false);
  });
});
