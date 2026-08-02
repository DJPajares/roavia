// @vitest-environment jsdom

import type { RoaviaApiClient } from "@roavia/api-client";
import type { DisruptionRecommendation } from "@roavia/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, test, vi } from "vitest";

import { DisruptionRecommendations } from "../components/disruption-recommendations";

const tripId = "10000000-0000-4000-8000-000000000001";
const recommendationId = "20000000-0000-4000-8000-000000000002";
const itemId = "30000000-0000-4000-8000-000000000003";
const originalPlaceId = "40000000-0000-4000-8000-000000000004";
const alternativePlaceId = "50000000-0000-4000-8000-000000000005";

const recommendation: DisruptionRecommendation = {
  alternative: {
    explanation:
      "The indoor museum keeps the morning slot while avoiding forecast outdoor exposure.",
    itemType: "activity",
    localDate: "2026-08-10",
    name: "Indoor Museum",
    placeId: alternativePlaceId,
    source: {
      retrievedAt: "2026-08-02T00:00:00.000Z",
      sourceId: "museum-source",
      title: "Official museum guide",
      updatedAt: "2026-08-02T00:00:00.000Z",
      url: "https://museum.example.test/visit",
    },
    timeLabel: "9:00 AM",
  },
  confidence: {
    explanation: "Fresh weather and approved place evidence support this comparison.",
    level: "high",
    score: 0.9,
  },
  createdAt: "2026-08-02T01:00:00.000Z",
  id: recommendationId,
  impact: {
    impactId: "60000000-0000-4000-8000-000000000006",
    kind: "weather",
    reason: "Heavy rain is expected during the outdoor visit.",
    severity: "high",
    source: {
      retrievedAt: "2026-08-02T00:45:00.000Z",
      sourceId: "weather-source",
      title: "Official weather service",
      updatedAt: "2026-08-02T00:40:00.000Z",
      url: "https://weather.example.test/event",
    },
  },
  original: {
    itemId,
    itemType: "activity",
    localDate: "2026-08-10",
    name: "Garden Walk",
    placeId: originalPlaceId,
    timeLabel: "9:00 AM",
  },
  status: "pending",
  tripId,
};

function api() {
  return {
    applyDisruptionRecommendation: vi
      .fn<RoaviaApiClient["applyDisruptionRecommendation"]>()
      .mockResolvedValue({
        data: { recommendationId, status: "applied", tripId, tripRevision: 2 },
        meta: { requestId: "70000000-0000-4000-8000-000000000007" },
      }),
    decideDisruptionRecommendation: vi
      .fn<RoaviaApiClient["decideDisruptionRecommendation"]>()
      .mockResolvedValue({
        data: { recommendationId, status: "kept", tripId, tripRevision: null },
        meta: { requestId: "70000000-0000-4000-8000-000000000007" },
      }),
    refreshDisruptionRecommendations: vi
      .fn<RoaviaApiClient["refreshDisruptionRecommendations"]>()
      .mockResolvedValue({
        data: { liveDataStatus: "fresh", recommendations: [recommendation] },
        meta: { requestId: "70000000-0000-4000-8000-000000000007" },
      }),
  } as unknown as RoaviaApiClient;
}

describe("DisruptionRecommendations", () => {
  test("shows an accessible source-aware comparison and applies only after confirmation", async () => {
    const client = api();
    const onApplied = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const user = userEvent.setup();
    const rendered = render(
      <DisruptionRecommendations
        api={client}
        offline={false}
        onApplied={onApplied}
        tripId={tripId}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "Review an alternative for Garden Walk" }),
    ).toBeDefined();
    expect(screen.getByText("Heavy rain is expected during the outdoor visit.")).toBeDefined();
    expect(screen.getByText("high confidence · 90%")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Official weather service" }).getAttribute("href"),
    ).toBe("https://weather.example.test/event");
    expect(screen.getByRole("link", { name: "Official museum guide" }).getAttribute("href")).toBe(
      "https://museum.example.test/visit",
    );
    expect((await axe.run(rendered.container)).violations).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Apply alternative" }));
    expect(
      screen.getByRole("alertdialog", {
        name: "Replace Garden Walk with Indoor Museum?",
      }),
    ).toBeDefined();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Review again" }));
    expect(client.applyDisruptionRecommendation).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Confirm replacement" }));
    expect(client.applyDisruptionRecommendation).toHaveBeenCalledWith(tripId, recommendationId);
    expect(await screen.findByText(/Alternative applied through/)).toBeDefined();
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  test("persists keep-original and explains stale or offline suppression", async () => {
    const client = api();
    const user = userEvent.setup();
    const { rerender } = render(
      <DisruptionRecommendations
        api={client}
        offline={false}
        onApplied={vi.fn<() => Promise<void>>()}
        tripId={tripId}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "Keep original" }));
    expect(await screen.findByText(/Original kept/)).toBeDefined();
    expect(client.decideDisruptionRecommendation).toHaveBeenCalledWith(tripId, recommendationId, {
      decision: "keep",
    });

    rerender(
      <DisruptionRecommendations
        api={client}
        offline
        onApplied={vi.fn<() => Promise<void>>()}
        tripId={tripId}
      />,
    );
    expect(await screen.findByText(/Live alternatives are unavailable offline/)).toBeDefined();
  });
});
