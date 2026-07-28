import { describe, expect, test } from "vitest";

import { shareLinkCreateInputSchema, sharedTripResponseSchema } from "../src/index.js";

const requestId = "11111111-1111-4111-8111-111111111111";

describe("trip-sharing contracts", () => {
  test("defaults to a finite expiry and enforces the 180-day maximum", () => {
    expect(shareLinkCreateInputSchema.parse({})).toEqual({ expiresInDays: 30 });
    expect(shareLinkCreateInputSchema.parse({ expiresInDays: 180 })).toEqual({
      expiresInDays: 180,
    });
    expect(shareLinkCreateInputSchema.safeParse({ expiresInDays: 181 }).success).toBe(false);
    expect(shareLinkCreateInputSchema.safeParse({ expiresInDays: null }).success).toBe(false);
  });

  test("allows only approved itinerary fields in the public response", () => {
    const response = sharedTripResponseSchema.parse({
      data: {
        title: "Kyoto slow days",
        startDate: "2026-08-01",
        endDate: "2026-08-02",
        updatedAt: "2026-07-28T10:00:00.000Z",
        expiresAt: "2026-08-27T10:00:00.000Z",
        ownerEmail: "private@example.com",
        travelerSummary: { adults: 2 },
        days: [
          {
            localDate: "2026-08-01",
            timezone: "Asia/Tokyo",
            title: "Arrival rhythm",
            notes: null,
            orderIndex: 0,
            internalDayId: "22222222-2222-4222-8222-222222222222",
            items: [
              {
                itemType: "activity",
                startTime: "09:00",
                endTime: "10:00",
                durationMinutes: 60,
                estimatedCost: null,
                sourceSnapshot: { place: { name: "Morning walk" } },
                route: null,
                confidence: 0.8,
                notes: "Meet by the gate",
                orderIndex: 0,
                booking: { confirmation: "PRIVATE-42" },
              },
            ],
          },
        ],
      },
      meta: { requestId },
    });

    expect(response.data).not.toHaveProperty("ownerEmail");
    expect(response.data).not.toHaveProperty("travelerSummary");
    expect(response.data.days[0]).not.toHaveProperty("internalDayId");
    expect(response.data.days[0]?.items[0]).not.toHaveProperty("booking");
  });
});
