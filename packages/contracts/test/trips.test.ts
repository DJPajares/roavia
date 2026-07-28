import {
  tripCreateInputSchema,
  tripDayCreateInputSchema,
  tripItemCreateInputSchema,
  tripUpdateInputSchema,
} from "@roavia/contracts";
import { describe, expect, test } from "vitest";

const validTrip = {
  budget: { amountMinor: 250_000, currency: "USD", style: "midrange" },
  endDate: "2026-09-12",
  startDate: "2026-09-05",
  title: "Japan in autumn",
  travelerSummary: { adults: 2 },
};

describe("trip domain contracts", () => {
  test("normalizes defaults for a valid trip", () => {
    expect(tripCreateInputSchema.parse(validTrip)).toMatchObject({
      budget: validTrip.budget,
      dateFlexibility: { daysAfter: 0, daysBefore: 0 },
      originPlaceId: null,
      status: "draft",
      travelerSummary: { adults: 2, children: 0, infants: 0 },
      visibility: "private",
    });
  });

  test.each([
    [{ ...validTrip, endDate: "2026-09-04" }, "date order"],
    [{ ...validTrip, startDate: "2026-02-30" }, "calendar date"],
    [{ ...validTrip, travelerSummary: { adults: 0 } }, "traveler count"],
    [{ ...validTrip, budget: { ...validTrip.budget, currency: "usd" } }, "currency"],
  ])("rejects invalid trip input: %s", (candidate) => {
    expect(tripCreateInputSchema.safeParse(candidate).success).toBe(false);
  });

  test("requires a mutation in addition to the revision token", () => {
    expect(tripUpdateInputSchema.safeParse({ expectedRevision: 1 }).success).toBe(false);
  });

  test("validates IANA time zones and paired local item times", () => {
    expect(
      tripDayCreateInputSchema.safeParse({
        expectedTripRevision: 1,
        localDate: "2026-09-06",
        timezone: "Not/A_Timezone",
      }).success,
    ).toBe(false);
    expect(
      tripItemCreateInputSchema.safeParse({
        endTime: null,
        expectedTripRevision: 1,
        itineraryDayId: "11111111-1111-4111-8111-111111111111",
        itemType: "activity",
        startTime: "09:00",
      }).success,
    ).toBe(false);
  });
});
