import { randomUUID } from "node:crypto";

import { createDatabaseClient, createTripRepository } from "@roavia/db";
import { describe, expect, test } from "vitest";

import { createApp } from "../src/app.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

interface Fixture {
  aliceAuthUserId: string;
  aliceUserId: string;
  bobAuthUserId: string;
  bobUserId: string;
  placeIds: [string, string];
}

async function seedFixture(client: ReturnType<typeof createDatabaseClient>): Promise<Fixture> {
  const fixture: Fixture = {
    aliceAuthUserId: randomUUID(),
    aliceUserId: randomUUID(),
    bobAuthUserId: randomUUID(),
    bobUserId: randomUUID(),
    placeIds: [randomUUID(), randomUUID()],
  };
  await client.pool.query(
    `insert into users (id, auth_user_id, display_name)
     values ($1, $2, 'Trip API Alice'), ($3, $4, 'Trip API Bob')`,
    [fixture.aliceUserId, fixture.aliceAuthUserId, fixture.bobUserId, fixture.bobAuthUserId],
  );
  await client.pool.query(
    `insert into places (id, place_type, canonical_name, timezone, country_code)
     values
       ($1, 'city', 'Tokyo', 'Asia/Tokyo', 'JP'),
       ($2, 'city', 'Kyoto', 'Asia/Tokyo', 'JP')`,
    fixture.placeIds,
  );
  return fixture;
}

function headers(token: "alice" | "bob", requestId = randomUUID()) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-request-id": requestId,
  };
}

describeDatabase("trip API with PostgreSQL", () => {
  test("supports owner-scoped CRUD, stable ordering, validation, and concurrent edits", async () => {
    const client = createDatabaseClient(testDatabaseUrl!);
    const fixture = await seedFixture(client);
    const app = createApp({
      tripRepository: createTripRepository(client.db),
      verifyAccessToken: async (token) => ({
        expiresAt: "2026-07-28T12:00:00.000Z",
        identity: {
          userId: token === "alice" ? fixture.aliceAuthUserId : fixture.bobAuthUserId,
        },
      }),
    });
    let tripId: string | undefined;

    try {
      const createdResponse = await app.request("/trips", {
        body: JSON.stringify({
          budget: { amountMinor: 300_000, currency: "JPY", style: "midrange" },
          endDate: "2026-10-06",
          originPlaceId: fixture.placeIds[0],
          startDate: "2026-10-01",
          title: "Japan food trip",
          travelerSummary: { adults: 2 },
        }),
        headers: headers("alice"),
        method: "POST",
      });
      expect(createdResponse.status).toBe(201);
      const created = (await createdResponse.json()) as {
        data: { id: string; revision: number };
      };
      tripId = created.data.id;
      let revision = created.data.revision;
      expect(revision).toBe(1);

      const firstDestinationResponse = await app.request(`/trips/${tripId}/destinations`, {
        body: JSON.stringify({
          expectedTripRevision: revision,
          placeId: fixture.placeIds[0],
        }),
        headers: headers("alice"),
        method: "POST",
      });
      expect(firstDestinationResponse.status).toBe(201);
      const firstDestination = (await firstDestinationResponse.json()) as {
        data: { destination: { id: string }; tripRevision: number };
      };
      revision = firstDestination.data.tripRevision;

      const secondDestinationResponse = await app.request(`/trips/${tripId}/destinations`, {
        body: JSON.stringify({
          expectedTripRevision: revision,
          orderIndex: 0,
          placeId: fixture.placeIds[1],
        }),
        headers: headers("alice"),
        method: "POST",
      });
      expect(secondDestinationResponse.status).toBe(201);
      const secondDestination = (await secondDestinationResponse.json()) as {
        data: { destination: { id: string }; tripRevision: number };
      };
      revision = secondDestination.data.tripRevision;

      const firstDayResponse = await app.request(`/trips/${tripId}/days`, {
        body: JSON.stringify({
          expectedTripRevision: revision,
          localDate: "2026-10-02",
          timezone: "Asia/Tokyo",
          title: "Tokyo",
        }),
        headers: headers("alice"),
        method: "POST",
      });
      expect(firstDayResponse.status).toBe(201);
      const firstDay = (await firstDayResponse.json()) as {
        data: { day: { id: string }; tripRevision: number };
      };
      revision = firstDay.data.tripRevision;

      const secondDayResponse = await app.request(`/trips/${tripId}/days`, {
        body: JSON.stringify({
          expectedTripRevision: revision,
          localDate: "2026-10-03",
          orderIndex: 0,
          timezone: "Asia/Tokyo",
          title: "Kyoto",
        }),
        headers: headers("alice"),
        method: "POST",
      });
      expect(secondDayResponse.status).toBe(201);
      const secondDay = (await secondDayResponse.json()) as {
        data: { day: { id: string }; tripRevision: number };
      };
      revision = secondDay.data.tripRevision;

      const firstItemResponse = await app.request(`/trips/${tripId}/items`, {
        body: JSON.stringify({
          endTime: "10:00",
          expectedTripRevision: revision,
          itineraryDayId: firstDay.data.day.id,
          itemType: "food",
          notes: "Breakfast",
          startTime: "09:00",
        }),
        headers: headers("alice"),
        method: "POST",
      });
      expect(firstItemResponse.status).toBe(201);
      const firstItem = (await firstItemResponse.json()) as {
        data: { item: { id: string }; tripRevision: number };
      };
      revision = firstItem.data.tripRevision;

      const secondItemResponse = await app.request(`/trips/${tripId}/items`, {
        body: JSON.stringify({
          endTime: "12:00",
          expectedTripRevision: revision,
          itineraryDayId: firstDay.data.day.id,
          itemType: "activity",
          notes: "Market",
          orderIndex: 0,
          startTime: "10:30",
        }),
        headers: headers("alice"),
        method: "POST",
      });
      expect(secondItemResponse.status).toBe(201);
      const secondItem = (await secondItemResponse.json()) as {
        data: { item: { id: string }; tripRevision: number };
      };
      revision = secondItem.data.tripRevision;

      const itemUpdateResponse = await app.request(
        `/trips/${tripId}/items/${firstItem.data.item.id}`,
        {
          body: JSON.stringify({ expectedTripRevision: revision, orderIndex: 0 }),
          headers: headers("alice"),
          method: "PATCH",
        },
      );
      expect(itemUpdateResponse.status).toBe(200);
      revision = ((await itemUpdateResponse.json()) as { data: { tripRevision: number } }).data
        .tripRevision;

      const destinationUpdateResponse = await app.request(
        `/trips/${tripId}/destinations/${firstDestination.data.destination.id}`,
        {
          body: JSON.stringify({ expectedTripRevision: revision, orderIndex: 0 }),
          headers: headers("alice"),
          method: "PATCH",
        },
      );
      expect(destinationUpdateResponse.status).toBe(200);
      revision = (
        (await destinationUpdateResponse.json()) as {
          data: { tripRevision: number };
        }
      ).data.tripRevision;

      const dayUpdateResponse = await app.request(
        `/trips/${tripId}/days/${secondDay.data.day.id}`,
        {
          body: JSON.stringify({ expectedTripRevision: revision, title: "Kyoto highlights" }),
          headers: headers("alice"),
          method: "PATCH",
        },
      );
      expect(dayUpdateResponse.status).toBe(200);
      revision = ((await dayUpdateResponse.json()) as { data: { tripRevision: number } }).data
        .tripRevision;

      const invalidDay = await app.request(`/trips/${tripId}/days`, {
        body: JSON.stringify({
          expectedTripRevision: revision,
          localDate: "2026-10-10",
          timezone: "Asia/Tokyo",
        }),
        headers: headers("alice"),
        method: "POST",
      });
      expect(invalidDay.status).toBe(400);
      await expect(invalidDay.json()).resolves.toMatchObject({ error: { code: "bad_request" } });

      const detailResponse = await app.request(`/trips/${tripId}`, {
        headers: headers("alice"),
      });
      expect(detailResponse.status).toBe(200);
      const detail = (await detailResponse.json()) as {
        data: {
          days: Array<{
            id: string;
            items: Array<{ id: string; orderIndex: number }>;
            orderIndex: number;
          }>;
          destinations: Array<{ id: string; orderIndex: number }>;
          revision: number;
        };
      };
      expect(detail.data.destinations.map(({ id, orderIndex }) => [id, orderIndex])).toEqual([
        [firstDestination.data.destination.id, 0],
        [secondDestination.data.destination.id, 1],
      ]);
      expect(detail.data.days.map(({ id, orderIndex }) => [id, orderIndex])).toEqual([
        [secondDay.data.day.id, 0],
        [firstDay.data.day.id, 1],
      ]);
      expect(detail.data.days[1]?.items.map(({ id, orderIndex }) => [id, orderIndex])).toEqual([
        [firstItem.data.item.id, 0],
        [secondItem.data.item.id, 1],
      ]);

      const unauthorizedRead = await app.request(`/trips/${tripId}`, {
        headers: headers("bob"),
      });
      const unauthorizedWrite = await app.request(`/trips/${tripId}`, {
        body: JSON.stringify({ expectedRevision: revision, title: "Stolen" }),
        headers: headers("bob"),
        method: "PATCH",
      });
      expect(unauthorizedRead.status).toBe(404);
      expect(unauthorizedWrite.status).toBe(404);

      const [firstConcurrent, secondConcurrent] = await Promise.all([
        app.request(`/trips/${tripId}`, {
          body: JSON.stringify({ expectedRevision: revision, title: "Japan spring trip" }),
          headers: headers("alice"),
          method: "PATCH",
        }),
        app.request(`/trips/${tripId}`, {
          body: JSON.stringify({ expectedRevision: revision, title: "Japan autumn trip" }),
          headers: headers("alice"),
          method: "PATCH",
        }),
      ]);
      expect(new Set([firstConcurrent.status, secondConcurrent.status])).toEqual(
        new Set([200, 409]),
      );
      const successfulConcurrent =
        firstConcurrent.status === 200 ? firstConcurrent : secondConcurrent;
      revision = ((await successfulConcurrent.json()) as { data: { revision: number } }).data
        .revision;

      const aliceList = await app.request("/trips?status=draft&limit=1", {
        headers: headers("alice"),
      });
      const bobList = await app.request("/trips", { headers: headers("bob") });
      expect(aliceList.status).toBe(200);
      await expect(aliceList.json()).resolves.toMatchObject({
        data: { trips: [{ id: tripId }], pagination: { limit: 1 } },
      });
      await expect(bobList.json()).resolves.toMatchObject({ data: { trips: [] } });

      const itemDelete = await app.request(`/trips/${tripId}/items/${firstItem.data.item.id}`, {
        body: JSON.stringify({ expectedTripRevision: revision }),
        headers: headers("alice"),
        method: "DELETE",
      });
      expect(itemDelete.status).toBe(200);
      revision = ((await itemDelete.json()) as { data: { tripRevision: number } }).data
        .tripRevision;

      const destinationDelete = await app.request(
        `/trips/${tripId}/destinations/${secondDestination.data.destination.id}`,
        {
          body: JSON.stringify({ expectedTripRevision: revision }),
          headers: headers("alice"),
          method: "DELETE",
        },
      );
      expect(destinationDelete.status).toBe(200);
      revision = ((await destinationDelete.json()) as { data: { tripRevision: number } }).data
        .tripRevision;

      const dayDelete = await app.request(`/trips/${tripId}/days/${secondDay.data.day.id}`, {
        body: JSON.stringify({ expectedTripRevision: revision }),
        headers: headers("alice"),
        method: "DELETE",
      });
      expect(dayDelete.status).toBe(200);
      revision = ((await dayDelete.json()) as { data: { tripRevision: number } }).data.tripRevision;

      const staleDelete = await app.request(`/trips/${tripId}`, {
        body: JSON.stringify({ expectedRevision: revision - 1 }),
        headers: headers("alice"),
        method: "DELETE",
      });
      expect(staleDelete.status).toBe(409);
      const deleted = await app.request(`/trips/${tripId}`, {
        body: JSON.stringify({ expectedRevision: revision }),
        headers: headers("alice"),
        method: "DELETE",
      });
      expect(deleted.status).toBe(200);
      const afterDelete = await app.request(`/trips/${tripId}`, {
        headers: headers("alice"),
      });
      expect(afterDelete.status).toBe(404);
    } finally {
      await client.pool.query("delete from audit_events where actor_user_id = any($1::uuid[])", [
        [fixture.aliceUserId, fixture.bobUserId],
      ]);
      await client.pool.query("delete from users where id = any($1::uuid[])", [
        [fixture.aliceUserId, fixture.bobUserId],
      ]);
      await client.pool.query("delete from places where id = any($1::uuid[])", [fixture.placeIds]);
      await client.close();
    }
  });
});
