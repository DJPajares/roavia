import { randomUUID } from "node:crypto";

import type { AssistantAnswer } from "@roavia/contracts";
import {
  createAssistantActionRepository,
  createDatabaseClient,
  createTripRepository,
} from "@roavia/db";
import { describe, expect, test } from "vitest";

import { createApp } from "../src/app.js";
import { createAssistantApiService } from "../src/assistant.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

const answer: AssistantAnswer = {
  actions: [],
  answer: "Save a reminder to check the official opening hours.",
  claims: [
    {
      claimId: "claim-1",
      confidence: { explanation: "Supported by approved official evidence.", level: "high" },
      sourceIds: ["source-official"],
      text: "Opening hours should be checked before visiting.",
    },
  ],
  evidence: { gaps: [], status: "complete" },
  safety: {
    classification: "general",
    disclaimer: null,
    explanation: "This is general travel guidance.",
    officialSourceRequired: false,
  },
  sources: [
    {
      freshness: "fresh",
      official: true,
      retrievedAt: "2026-07-29T00:00:00.000Z",
      sourceId: "source-official",
      title: "Official destination guide",
      url: "https://example.gov.test/guide",
      validUntil: null,
    },
  ],
  status: "answered",
  uncertainty: { explanation: "Hours can change.", level: "medium" },
};

function headers(token: string, requestId = randomUUID()) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-request-id": requestId,
  };
}

describeDatabase("assistant API with PostgreSQL", () => {
  test("keeps query and cancel read-only, then applies one confirmed action exactly once", async () => {
    const client = createDatabaseClient(testDatabaseUrl!);
    const authUserId = `assistant-api-${randomUUID()}`;
    const userId = randomUUID();
    const tripId = randomUUID();
    const placeId = randomUUID();
    const destinationId = randomUUID();
    const dayId = randomUUID();
    const itemId = randomUUID();
    const actionPayload = {
      itemId,
      kind: "save_note" as const,
      note: "Check official opening hours.",
      sourceIds: ["source-official"],
      summary: "Save an opening-hours reminder",
    };
    const trips = createTripRepository(client.db);
    const service = createAssistantApiService({
      actions: createAssistantActionRepository(client.db),
      assistant: { answer: async () => ({ actionPayloads: [actionPayload], answer }) },
      trips,
    });
    const app = createApp({
      assistantService: service,
      tripRepository: trips,
      verifyAccessToken: async () => ({
        expiresAt: "2026-07-29T23:00:00.000Z",
        identity: { userId: authUserId },
      }),
    });

    try {
      await client.pool.query(
        "insert into users (id, auth_user_id, display_name) values ($1, $2, 'Assistant API')",
        [userId, authUserId],
      );
      await client.pool.query(
        `insert into places (id, place_type, canonical_name, timezone, country_code)
         values ($1, 'city', 'Singapore', 'Asia/Singapore', 'SG')`,
        [placeId],
      );
      await client.pool.query(
        `insert into trips (id, owner_user_id, title, slug, start_date, end_date)
         values ($1, $2, 'Assistant API trip', $3, '2026-08-01', '2026-08-04')`,
        [tripId, userId, `assistant-api-${randomUUID()}`],
      );
      await client.pool.query(
        `insert into trip_destinations (id, trip_id, place_id, order_index)
         values ($1, $2, $3, 0)`,
        [destinationId, tripId, placeId],
      );
      await client.pool.query(
        `insert into itinerary_days (id, trip_id, local_date, timezone, order_index)
         values ($1, $2, '2026-08-02', 'Asia/Singapore', 0)`,
        [dayId, tripId],
      );
      await client.pool.query(
        `insert into itinerary_items (id, itinerary_day_id, place_id, item_type, order_index)
         values ($1, $2, $3, 'activity', 0)`,
        [itemId, dayId, placeId],
      );

      const queryBody = JSON.stringify({
        context: { tripId, type: "trip" },
        locale: "en",
        question: "What should I check before visiting?",
      });
      const firstQuery = await app.request("/assistant/query", {
        body: queryBody,
        headers: headers("alice"),
        method: "POST",
      });
      expect(firstQuery.status).toBe(200);
      const first = (await firstQuery.json()) as { data: { actions: Array<{ actionId: string }> } };
      expect(first.data.actions).toHaveLength(1);

      const beforeDecision = await client.pool.query<{ notes: string | null }>(
        "select notes from itinerary_items where id = $1",
        [itemId],
      );
      expect(beforeDecision.rows[0]?.notes).toBeNull();

      const cancelled = await app.request(
        `/assistant/actions/${first.data.actions[0]!.actionId}/cancel`,
        { headers: headers("alice"), method: "POST" },
      );
      expect(cancelled.status).toBe(200);
      expect(
        (
          await client.pool.query<{ notes: string | null }>(
            "select notes from itinerary_items where id = $1",
            [itemId],
          )
        ).rows[0]?.notes,
      ).toBeNull();

      const secondQuery = await app.request("/assistant/query", {
        body: queryBody,
        headers: headers("alice"),
        method: "POST",
      });
      const second = (await secondQuery.json()) as {
        data: { actions: Array<{ actionId: string }> };
      };
      const confirmedActionId = second.data.actions[0]!.actionId;
      const confirmed = await app.request(`/assistant/actions/${confirmedActionId}/confirm`, {
        headers: headers("alice"),
        method: "POST",
      });
      expect(confirmed.status).toBe(200);
      await expect(confirmed.json()).resolves.toMatchObject({
        data: { actionId: confirmedActionId, status: "applied", tripRevision: 2 },
      });
      expect(
        (
          await client.pool.query<{ notes: string | null }>(
            "select notes from itinerary_items where id = $1",
            [itemId],
          )
        ).rows[0]?.notes,
      ).toBe(actionPayload.note);

      const replayed = await app.request(`/assistant/actions/${confirmedActionId}/confirm`, {
        headers: headers("alice"),
        method: "POST",
      });
      expect(replayed.status).toBe(409);
      const audits = await client.pool.query<{ outcome: string }>(
        "select outcome from audit_events where subject_id = $1",
        [confirmedActionId],
      );
      expect(audits.rows).toEqual([{ outcome: "succeeded" }]);
    } finally {
      await client.pool.query("delete from users where id = $1", [userId]);
      await client.close();
    }
  });
});
