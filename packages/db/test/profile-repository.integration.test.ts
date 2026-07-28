import { randomUUID } from "node:crypto";

import { describe, expect, test } from "vitest";

import { createDatabaseClient } from "../src/client.js";
import { createProfileRepository } from "../src/profile-repository.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase("profile repository", () => {
  test("provisions and updates profiles only within the authenticated owner's scope", async () => {
    const client = createDatabaseClient(testDatabaseUrl!);
    const aliceAuthUserId = `profile-alice-${randomUUID()}`;
    const bobAuthUserId = `profile-bob-${randomUUID()}`;
    const repository = createProfileRepository(client.db);

    try {
      const aliceDefault = await repository.getProfile({
        authUserId: aliceAuthUserId,
        email: "alice@roavia.test",
      });
      const bobDefault = await repository.getProfile({
        authUserId: bobAuthUserId,
        email: "bob@roavia.test",
      });
      const aliceUpdated = await repository.updateProfile(
        { authUserId: aliceAuthUserId, email: "alice@roavia.test" },
        {
          defaultPace: "slow",
          homeCountry: "SG",
          interests: ["Food"],
          locale: "en-SG",
          preferredCurrency: "SGD",
          timezone: "Asia/Singapore",
          travelPreferences: { mustAvoid: ["Crowds"], mustDo: ["Hawker food"] },
        },
      );
      const bobAfterAliceUpdate = await repository.getProfile({
        authUserId: bobAuthUserId,
        email: "bob@roavia.test",
      });

      expect(aliceDefault).toMatchObject({
        email: "alice@roavia.test",
        locale: "en",
        travelPreferences: { mustAvoid: [], mustDo: [] },
      });
      expect(bobDefault).toMatchObject({
        email: "bob@roavia.test",
        defaultPace: "balanced",
      });
      expect(aliceUpdated).toMatchObject({
        defaultPace: "slow",
        homeCountry: "SG",
        interests: ["Food"],
        timezone: "Asia/Singapore",
      });
      expect(bobAfterAliceUpdate).toMatchObject({
        defaultPace: "balanced",
        homeCountry: null,
        interests: [],
      });
    } finally {
      await client.pool.query("delete from users where auth_user_id = any($1::text[])", [
        [aliceAuthUserId, bobAuthUserId],
      ]);
      await client.close();
    }
  });
});
