import { randomUUID } from "node:crypto";

import { describe, expect, test } from "vitest";

import { AuthorizedResourceNotFoundError } from "../src/authorization.js";
import {
  AssistantActionConflictError,
  createAssistantActionRepository,
} from "../src/assistant-action-repository.js";
import { createDatabaseClient } from "../src/client.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase("assistant action repository", () => {
  test("creates owner-scoped previews with one-time confirm and cancel transitions", async () => {
    const client = createDatabaseClient(testDatabaseUrl!);
    const aliceAuthUserId = `assistant-alice-${randomUUID()}`;
    const bobAuthUserId = `assistant-bob-${randomUUID()}`;
    const aliceUserId = randomUUID();
    const bobUserId = randomUUID();
    const tripId = randomUUID();
    const itemId = randomUUID();
    const repository = createAssistantActionRepository(client.db);
    const now = new Date("2026-07-29T12:00:00.000Z");

    try {
      await client.pool.query(
        `insert into users (id, auth_user_id, display_name)
         values ($1, $2, 'Assistant Alice'), ($3, $4, 'Assistant Bob')`,
        [aliceUserId, aliceAuthUserId, bobUserId, bobAuthUserId],
      );
      await client.pool.query(
        `insert into trips (id, owner_user_id, title, slug, start_date, end_date)
         values ($1, $2, 'Assistant trip', $3, '2026-08-01', '2026-08-04')`,
        [tripId, aliceUserId, `assistant-${randomUUID()}`],
      );

      const previews = await repository.createPreviews(
        aliceAuthUserId,
        tripId,
        1,
        [
          {
            itemId,
            kind: "remove_item",
            sourceIds: ["source-official"],
            summary: "Remove the closed attraction",
          },
          {
            itemId,
            kind: "save_note",
            note: "Check the official opening hours before leaving.",
            sourceIds: ["source-official"],
            summary: "Save an opening-hours reminder",
          },
        ],
        { correlationId: randomUUID(), now },
      );

      expect(previews).toHaveLength(2);
      await expect(
        repository.claim(bobAuthUserId, previews[0]!.actionId, { now }),
      ).rejects.toBeInstanceOf(AuthorizedResourceNotFoundError);

      const claimed = await repository.claim(aliceAuthUserId, previews[0]!.actionId, { now });
      expect(claimed).toMatchObject({ expectedTripRevision: 1, tripId });
      await expect(
        repository.claim(aliceAuthUserId, previews[0]!.actionId, { now }),
      ).rejects.toBeInstanceOf(AssistantActionConflictError);
      await repository.resolve(previews[0]!.actionId, "applied", { now });

      await expect(
        repository.cancel(aliceAuthUserId, previews[0]!.actionId, { now }),
      ).rejects.toBeInstanceOf(AssistantActionConflictError);
      await expect(
        repository.cancel(aliceAuthUserId, previews[1]!.actionId, { now }),
      ).resolves.toEqual({ actionId: previews[1]!.actionId, tripId });

      const actions = await client.pool.query<{ status: string }>(
        "select status from assistant_actions where trip_id = $1 order by created_at, id",
        [tripId],
      );
      expect(actions.rows.map(({ status }) => status).toSorted()).toEqual(["applied", "cancelled"]);
      const audit = await client.pool.query<{ outcome: string }>(
        "select outcome from audit_events where subject_id = $1",
        [previews[0]!.actionId],
      );
      expect(audit.rows).toEqual([{ outcome: "succeeded" }]);
    } finally {
      await client.pool.query("delete from users where id = any($1::uuid[])", [
        [aliceUserId, bobUserId],
      ]);
      await client.close();
    }
  });
});
