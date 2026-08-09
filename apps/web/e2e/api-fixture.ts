import type { Page, Route } from "@playwright/test";
import type {
  AssistantAnswer,
  DestinationDetailResponse,
  DestinationSeasonalInsight,
  OfflinePackageRecord,
  Profile,
  ShareLink,
  SharedTrip,
  TripDetail,
  TripIntentExtraction,
} from "@roavia/contracts";

export const requestId = "10000000-0000-4000-8000-000000000001";
export const tripId = "20000000-0000-4000-8000-000000000002";
export const placeId = "30000000-0000-4000-8000-000000000003";
export const dayId = "40000000-0000-4000-8000-000000000004";
export const itemId = "50000000-0000-4000-8000-000000000005";
export const destinationId = "60000000-0000-4000-8000-000000000006";
export const generationRunId = "70000000-0000-4000-8000-000000000007";
export const jobId = "80000000-0000-4000-8000-000000000008";
export const shareLinkId = "90000000-0000-4000-8000-000000000009";
export const actionId = "a0000000-0000-4000-8000-00000000000a";
export const shareToken = "R".repeat(43);

const now = "2026-08-09T01:00:00.000Z";

const profile = {
  accessibilityNeeds: ["Step-free routes"],
  defaultBudgetStyle: "midrange",
  defaultPace: "balanced",
  dietaryNeeds: ["Vegetarian"],
  email: "journey@roavia.test",
  homeCountry: "SG",
  interests: ["Food", "Museums"],
  locale: "en-SG",
  preferredCurrency: "SGD",
  timezone: "Asia/Singapore",
  travelPreferences: { mustAvoid: ["Overnight buses"], mustDo: ["Local markets"] },
  updatedAt: now,
} satisfies Profile;

function baseTrip(): TripDetail {
  return {
    budget: { amountMinor: 500_000, currency: "SGD", style: "midrange" },
    createdAt: now,
    dateFlexibility: { daysAfter: 1, daysBefore: 1 },
    days: [
      {
        id: dayId,
        items: [
          {
            booking: {},
            confidence: 0.86,
            durationMinutes: 90,
            endTime: "11:00",
            estimatedCost: { amountMinor: 2_000, currency: "SGD" },
            id: itemId,
            itineraryDayId: dayId,
            itemType: "activity",
            notes: "Meet by the east gate.",
            orderIndex: 0,
            placeId,
            sourceSnapshot: {
              place: {
                address: "Nakagyo Ward, Kyoto",
                coordinates: { latitude: 35.0116, longitude: 135.7681 },
                name: "Morning walk",
              },
              source: {
                freshness: "fresh",
                label: "Official city guide",
                retrievedAt: now,
                url: "https://example.gov.test/kyoto",
              },
            },
            startTime: "09:30",
            transport: {},
          },
        ],
        localDate: "2099-10-10",
        notes: "A gentle arrival day.",
        orderIndex: 0,
        timezone: "Asia/Tokyo",
        title: "Arrival rhythm",
        tripId,
      },
    ],
    destinations: [
      {
        arrivalAt: null,
        departureAt: null,
        id: destinationId,
        orderIndex: 0,
        placeId,
        tripId,
      },
    ],
    endDate: "2099-10-15",
    generation: null,
    generationState: "ready",
    id: tripId,
    originPlaceId: null,
    planningPreferences: {
      accessibilityNeeds: ["step-free routes"],
      dietaryNeeds: ["vegetarian"],
      interests: ["food", "museums"],
      mustAvoid: ["overnight buses"],
      mustDo: ["local markets"],
      pace: "balanced",
    },
    revision: 4,
    slug: "kyoto-recovery-journey",
    startDate: "2099-10-10",
    status: "active",
    title: "Kyoto recovery journey",
    travelerSummary: { adults: 2, children: 0, infants: 0 },
    updatedAt: now,
    visibility: "private",
  };
}

const extraction = {
  assumptions: [{ field: "pace", summary: "A balanced pace was inferred." }],
  intent: {
    budget: { amountMinor: 500_000, currency: "SGD", style: "midrange" },
    constraints: {
      accessibility: ["step-free routes"],
      dietary: ["vegetarian"],
      mustAvoid: ["overnight buses"],
      mustDo: ["local markets"],
    },
    dateFlexibility: { daysAfter: 1, daysBefore: 1 },
    destinations: [
      {
        candidates: [
          {
            canonicalName: "Kyoto",
            countryCode: "JP",
            hierarchy: [],
            id: placeId,
            localizedNames: { ja: "京都" },
            placeType: "city",
          },
        ],
        query: "Kyoto",
        selectedPlaceId: placeId,
      },
    ],
    endDate: "2099-10-15",
    interests: ["food", "museums"],
    pace: "balanced",
    startDate: "2099-10-10",
    title: "Kyoto recovery journey",
    travelers: { adults: 2, children: 0, infants: 0 },
  },
  issues: [],
  status: "needs_review",
} satisfies TripIntentExtraction;

const destination = {
  content: [
    {
      data: { currency: "Japanese yen", transit: "IC cards are widely accepted." },
      freshness: "stale",
      id: "b0000000-0000-4000-8000-00000000000b",
      refreshedAt: "2026-07-01T00:00:00.000Z",
      sources: [
        {
          attribution: "Kyoto City Official Travel Guide",
          id: "c0000000-0000-4000-8000-00000000000c",
          kind: "official_authority",
          license: "official-site-terms",
          licenseUrl: "https://kyoto.travel/en/terms.html",
          retrievedAt: "2026-07-01T00:00:00.000Z",
          title: "Kyoto City Official Travel Guide",
          url: "https://kyoto.travel/en/",
        },
      ],
      type: "practical",
    },
  ],
  place: {
    canonicalName: "Kyoto",
    countryCode: "JP",
    hierarchy: [],
    id: placeId,
    localizedNames: { ja: "京都" },
    placeType: "city",
    summary: "A source-aware guide with explicit freshness.",
    timezone: "Asia/Tokyo",
  },
} satisfies DestinationDetailResponse["data"];

const signalNames = [
  "weather",
  "rainfall",
  "temperature",
  "crowds",
  "prices",
  "festivals",
  "holidays",
  "closures",
] as const;

const seasonalInsight = {
  confidence: 0.67,
  explanation: {
    caveats: ["Weather evidence needs refresh."],
    summary: "Autumn has useful signals with freshness tradeoffs.",
    tradeoffs: ["Mild weather can coincide with higher crowds."],
  },
  period: { kind: "month", month: 10, year: 2099 },
  periodKey: "month:2099-10",
  placeId,
  priorities: { budget: 1, closures: 1, crowds: 1, festivals: 1, weather: 1 },
  rating: "mixed",
  refreshedAt: now,
  score: 0.58,
  signals: Object.fromEntries(
    signalNames.map((signal) => [
      signal,
      {
        confidence: signal === "closures" ? null : 0.67,
        evidence:
          signal === "closures"
            ? []
            : [
                {
                  confidence: 0.67,
                  favorability: 0.6,
                  precision: "qualitative",
                  refreshedAt: now,
                  signal,
                  sourceId: `source:${signal}`,
                  ...(signal === "weather" ? { staleAt: "2026-07-01T00:00:00.000Z" } : {}),
                  summary: `${signal} evidence is available for comparison.`,
                },
              ],
        favorability: signal === "closures" ? null : 0.6,
        refreshedAt: signal === "closures" ? null : now,
        sourceIds: signal === "closures" ? [] : [`source:${signal}`],
        state: signal === "closures" ? "missing" : signal === "weather" ? "stale" : "available",
      },
    ]),
  ) as DestinationSeasonalInsight["signals"],
  sourceIds: ["source:weather", "source:crowds"],
} satisfies DestinationSeasonalInsight;

const assistantAnswer = {
  actions: [
    {
      actionId,
      expectedTripRevision: 4,
      expiresAt: "2099-10-01T00:15:00.000Z",
      payload: {
        itemId,
        kind: "save_note",
        note: "Confirm current opening hours.",
        sourceIds: ["source:official"],
        summary: "Save an opening-hours reminder",
      },
      status: "pending",
      tripId,
    },
  ],
  answer: "The official guide recommends confirming opening hours before departure.",
  claims: [
    {
      claimId: "claim:hours",
      confidence: { explanation: "Official but subject to change.", level: "high" },
      sourceIds: ["source:official"],
      text: "Opening hours should be confirmed.",
    },
  ],
  evidence: { gaps: [], status: "complete" },
  safety: {
    classification: "general",
    disclaimer: null,
    explanation: "General travel guidance.",
    officialSourceRequired: false,
  },
  sources: [
    {
      freshness: "fresh",
      official: true,
      retrievedAt: now,
      sourceId: "source:official",
      title: "Official destination guide",
      url: "https://example.gov.test/guide",
      validUntil: null,
    },
  ],
  status: "answered",
  uncertainty: { explanation: "Opening hours can change.", level: "medium" },
} satisfies AssistantAnswer;

const shareLink = {
  createdAt: now,
  expiresAt: "2099-11-09T01:00:00.000Z",
  id: shareLinkId,
  permission: "view",
  revokedAt: null,
  status: "active",
} satisfies ShareLink;

function sharedTrip(trip: TripDetail): SharedTrip {
  return {
    days: trip.days.map((day) => ({
      items: day.items.map((item) => {
        const snapshot = item.sourceSnapshot as {
          place?: {
            address?: string;
            coordinates?: { latitude: number; longitude: number };
            name: string;
          };
          source?: {
            freshness: "fresh" | "stale";
            label: string;
            retrievedAt: string;
            url?: string;
          };
        };
        return {
          confidence: item.confidence,
          durationMinutes: item.durationMinutes,
          endTime: item.endTime,
          estimatedCost: item.estimatedCost,
          itemType: item.itemType,
          notes: item.notes,
          orderIndex: item.orderIndex,
          route: null,
          sourceSnapshot: {
            ...snapshot,
            source: snapshot.source ? { ...snapshot.source, freshness: "stale" } : undefined,
          },
          startTime: item.startTime,
        };
      }),
      localDate: day.localDate,
      notes: day.notes,
      orderIndex: day.orderIndex,
      timezone: day.timezone,
      title: day.title,
    })),
    endDate: trip.endDate,
    expiresAt: shareLink.expiresAt,
    startDate: trip.startDate,
    title: trip.title,
    updatedAt: trip.updatedAt,
  };
}

function offlinePackage(trip: TripDetail): OfflinePackageRecord {
  return {
    expiresAt: null,
    generatedAt: now,
    id: "d0000000-0000-4000-8000-00000000000d",
    manifest: {
      contentHash: "a".repeat(64),
      generatedAt: now,
      guidance: [],
      licensing: { excludedContent: [] },
      liveData: {
        assistantResponses: "unavailable_offline",
        bookingAvailability: "unavailable_offline",
        closures: "unavailable_offline",
        prices: "unavailable_offline",
        weather: "unavailable_offline",
      },
      packageVersion: 1,
      schemaVersion: 1,
      sizeBytes: 1_024,
      trip: {
        days: [],
        destinations: [],
        endDate: trip.endDate,
        id: trip.id,
        revision: trip.revision,
        startDate: trip.startDate,
        title: trip.title,
      },
    },
    sizeBytes: 1_024,
    tripId: trip.id,
    version: 1,
  };
}

type PlannerFailure = "none" | "quota";

export interface ApiFixtureState {
  aiRequests: number;
  delayOfflineDownload: boolean;
  destinationUnavailable: boolean;
  failGeneration: boolean;
  failNextOptimisticSave: boolean;
  plannerFailure: PlannerFailure;
  protectedRequestsWithoutAuth: number;
  trip: TripDetail;
}

function response(data: unknown) {
  return { data, meta: { requestId } };
}

function apiError(code: string, message: string) {
  return { error: { code, message, requestId } };
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ body: JSON.stringify(body), contentType: "application/json", status });
}

export async function installApiFixture(page: Page): Promise<ApiFixtureState> {
  const state: ApiFixtureState = {
    aiRequests: 0,
    delayOfflineDownload: false,
    destinationUnavailable: false,
    failGeneration: false,
    failNextOptimisticSave: false,
    plannerFailure: "none",
    protectedRequestsWithoutAuth: 0,
    trip: baseTrip(),
  };

  await page.context().route("http://127.0.0.1:8788/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (
      path.startsWith("/planner/") ||
      path.endsWith("/generate") ||
      path.endsWith("/regenerate")
    ) {
      state.aiRequests += 1;
    }
    const protectedPath =
      path === "/me" ||
      path.startsWith("/assistant/") ||
      path.startsWith("/planner/") ||
      path === "/trips" ||
      path.startsWith("/trips/");
    if (protectedPath && !request.headers()["authorization"]?.startsWith("Bearer ")) {
      state.protectedRequestsWithoutAuth += 1;
      await fulfillJson(
        route,
        apiError("authentication_required", "Authentication required."),
        401,
      );
      return;
    }

    if (method === "GET" && path === "/me") {
      await fulfillJson(route, response(profile));
      return;
    }
    if (method === "GET" && path === "/trips") {
      const {
        days: _days,
        destinations: _destinations,
        generation: _generation,
        ...trip
      } = state.trip;
      await fulfillJson(
        route,
        response({
          pagination: { limit: Number(url.searchParams.get("limit") ?? 20), nextCursor: null },
          trips: [trip],
        }),
      );
      return;
    }
    if (method === "POST" && path === "/planner/extract") {
      if (state.plannerFailure === "quota") {
        state.plannerFailure = "none";
        await fulfillJson(
          route,
          apiError("rate_limited", "Planning capacity is busy. Retry with the same request."),
          429,
        );
        return;
      }
      await fulfillJson(route, response(extraction));
      return;
    }
    if (method === "POST" && path === "/trips") {
      const input = request.postDataJSON() as Partial<TripDetail>;
      state.trip = {
        ...state.trip,
        ...input,
        days: [],
        destinations: [],
        generation: null,
        generationState: "idle",
        revision: 1,
        status: "draft",
        updatedAt: now,
      };
      await fulfillJson(route, response(state.trip));
      return;
    }
    if (method === "POST" && path === `/trips/${tripId}/destinations`) {
      const input = request.postDataJSON() as {
        arrivalAt: string | null;
        departureAt: string | null;
        orderIndex: number;
        placeId: string;
      };
      const tripDestination = {
        arrivalAt: input.arrivalAt,
        departureAt: input.departureAt,
        id: destinationId,
        orderIndex: input.orderIndex,
        placeId: input.placeId,
        tripId,
      };
      state.trip.destinations.push(tripDestination);
      state.trip.revision += 1;
      await fulfillJson(
        route,
        response({ destination: tripDestination, tripRevision: state.trip.revision }),
      );
      return;
    }
    if (method === "POST" && path === `/trips/${tripId}/days`) {
      const input = request.postDataJSON() as {
        localDate: string;
        notes: string | null;
        orderIndex: number;
        timezone: string;
        title: string | null;
      };
      const day = { ...input, id: crypto.randomUUID(), items: [], tripId };
      state.trip.days.push(day);
      state.trip.revision += 1;
      await fulfillJson(route, response({ day, tripRevision: state.trip.revision }));
      return;
    }
    if (method === "POST" && path === `/trips/${tripId}/generate`) {
      state.trip.generationState = "queued";
      state.trip.revision = 3;
      await fulfillJson(
        route,
        response({ generationRunId, jobId, status: "queued", tripRevision: state.trip.revision }),
      );
      return;
    }
    if (method === "POST" && path === `/trips/${tripId}/regenerate`) {
      state.failGeneration = false;
      state.trip.generationState = "queued";
      state.trip.revision += 1;
      await fulfillJson(
        route,
        response({ generationRunId, jobId, status: "queued", tripRevision: state.trip.revision }),
      );
      return;
    }
    if (method === "GET" && path === `/trips/${tripId}/generation`) {
      const failed = state.failGeneration;
      state.trip.generationState = failed ? "failed" : "ready";
      if (!failed && state.trip.days.length === 0) {
        state.trip.days = baseTrip().days;
      }
      await fulfillJson(
        route,
        response({
          assumptions: [],
          completedAt: failed ? now : now,
          createdAt: now,
          failureCode: failed ? "validation_failed_after_repair" : null,
          groundingStatus: failed ? "partial" : "complete",
          id: generationRunId,
          maxRepairAttempts: 2,
          overallConfidence: failed ? null : 0.82,
          repairAttempts: failed ? 2 : 0,
          sources: [],
          status: failed ? "failed" : "succeeded",
          tripRevision: state.trip.revision,
          warnings: [],
        }),
      );
      return;
    }
    if (method === "GET" && path === `/trips/${tripId}`) {
      await fulfillJson(route, response(state.trip));
      return;
    }
    if (method === "PATCH" && path === `/trips/${tripId}`) {
      const input = request.postDataJSON() as Partial<TripDetail> & { expectedRevision: number };
      const { expectedRevision: _expectedRevision, ...updates } = input;
      state.trip = { ...state.trip, ...updates, revision: state.trip.revision + 1, updatedAt: now };
      await fulfillJson(route, response(state.trip));
      return;
    }
    if (method === "POST" && path === `/trips/${tripId}/items`) {
      const input = request.postDataJSON() as TripDetail["days"][number]["items"][number];
      const item = { ...input, id: itemId };
      state.trip.days[0]!.items.push(item);
      state.trip.revision += 1;
      await fulfillJson(route, response({ item, tripRevision: state.trip.revision }));
      return;
    }
    if (method === "PATCH" && path === `/trips/${tripId}/items/${itemId}`) {
      if (state.failNextOptimisticSave) {
        state.failNextOptimisticSave = false;
        await fulfillJson(route, apiError("conflict", "The trip changed in another session."), 409);
        return;
      }
      const input = request.postDataJSON() as Record<string, unknown>;
      const current = state.trip.days[0]!.items[0]!;
      const { expectedTripRevision: _expectedTripRevision, ...updates } = input;
      const updated = { ...current, ...updates };
      state.trip.days[0]!.items[0] = updated;
      state.trip.revision += 1;
      await fulfillJson(route, response({ item: updated, tripRevision: state.trip.revision }));
      return;
    }
    if (method === "POST" && path.endsWith("/disruption-recommendations/refresh")) {
      await fulfillJson(route, response({ liveDataStatus: "none", recommendations: [] }));
      return;
    }
    if (method === "GET" && path === `/trips/${tripId}/share-links`) {
      await fulfillJson(route, response({ links: [] }));
      return;
    }
    if (method === "POST" && path === `/trips/${tripId}/share-links`) {
      await fulfillJson(route, response({ link: shareLink, token: shareToken }));
      return;
    }
    if (method === "GET" && path === `/shared-trips/${shareToken}`) {
      await fulfillJson(route, response(sharedTrip(state.trip)));
      return;
    }
    if (method === "POST" && path === `/trips/${tripId}/offline-package`) {
      if (state.delayOfflineDownload) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
      await fulfillJson(
        route,
        response({ package: offlinePackage(state.trip), reused: false }),
      ).catch(() => undefined);
      return;
    }
    if (method === "GET" && path === "/destinations/search") {
      await fulfillJson(
        route,
        response({
          pagination: { limit: 8, nextPage: null, page: 1, total: 1 },
          query: url.searchParams.get("q") ?? "",
          results: [
            {
              canonicalName: "Kyoto",
              countryCode: "JP",
              hierarchy: [],
              id: placeId,
              localizedNames: { ja: "京都" },
              placeType: "city",
            },
          ],
        }),
      );
      return;
    }
    if (method === "GET" && path === `/destinations/${placeId}`) {
      if (state.destinationUnavailable) {
        await fulfillJson(
          route,
          apiError("search_unavailable", "Destination provider timed out."),
          503,
        );
        return;
      }
      await fulfillJson(route, response(destination));
      return;
    }
    if (method === "GET" && path === `/destinations/${placeId}/seasonality`) {
      await fulfillJson(route, response({ insights: [seasonalInsight] }));
      return;
    }
    if (method === "POST" && path === "/assistant/query") {
      await fulfillJson(route, response(assistantAnswer));
      return;
    }
    if (method === "POST" && path === `/assistant/actions/${actionId}/confirm`) {
      await fulfillJson(
        route,
        response({ actionId, status: "applied", tripId, tripRevision: state.trip.revision + 1 }),
      );
      return;
    }

    await fulfillJson(
      route,
      apiError("not_found", `No browser fixture for ${method} ${path}.`),
      404,
    );
  });

  return state;
}
