// @vitest-environment jsdom

import axe from "axe-core";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { getDestinationSeasonality } = vi.hoisted(() => ({
  getDestinationSeasonality: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("../lib/api", () => ({ roaviaApi: { getDestinationSeasonality } }));

import { BestTimeCalendar } from "../components/best-time-calendar";

const placeId = "33333333-3333-4333-8333-333333333333";
const requestId = "66666666-6666-4666-8666-666666666666";
const signals = [
  "weather",
  "rainfall",
  "temperature",
  "crowds",
  "prices",
  "festivals",
  "holidays",
  "closures",
] as const;

function insight(month: number, options: { stale?: boolean } = {}) {
  return {
    confidence: 0.72,
    explanation: {
      caveats: [
        "This is a priority-based tradeoff view, not a universal best-time claim.",
        "Evidence is stale for weather.",
        "Evidence is unavailable for closures.",
      ],
      summary: "Evidence is mixed for the selected priorities.",
      tradeoffs: ["Weather is a relative strength.", "Prices evidence points to a tradeoff."],
    },
    period: { kind: "month" as const, month, year: 2027 },
    periodKey: `month:2027-${String(month).padStart(2, "0")}`,
    placeId,
    priorities: { budget: 1, closures: 1, crowds: 1, festivals: 1, weather: 1 },
    rating: "mixed" as const,
    refreshedAt: "2026-08-01T10:00:00.000Z",
    score: 0.58,
    signals: Object.fromEntries(
      signals.map((signal) => [
        signal,
        {
          confidence: signal === "closures" ? null : 0.72,
          evidence:
            signal === "closures"
              ? []
              : [
                  {
                    confidence: 0.72,
                    favorability: signal === "prices" ? 0.3 : 0.7,
                    precision:
                      signal === "prices" || signal === "crowds" ? "qualitative" : "measured",
                    refreshedAt: "2026-08-01T10:00:00.000Z",
                    signal,
                    sourceId: `source:${signal}`,
                    staleAt:
                      options.stale && signal === "weather"
                        ? "2026-07-01T00:00:00.000Z"
                        : undefined,
                    summary:
                      signal === "prices"
                        ? "Qualitative price evidence indicates a tradeoff."
                        : `${signal} evidence is available for this period.`,
                  },
                ],
          favorability: signal === "closures" ? null : signal === "prices" ? 0.3 : 0.7,
          refreshedAt: signal === "closures" ? null : "2026-08-01T10:00:00.000Z",
          sourceIds: signal === "closures" ? [] : [`source:${signal}`],
          state:
            signal === "closures"
              ? "missing"
              : signal === "crowds"
                ? "conflicting"
                : options.stale && signal === "weather"
                  ? "stale"
                  : "available",
        },
      ]),
    ),
    sourceIds: ["source:climate", "source:holidays"],
  };
}

describe("BestTimeCalendar", () => {
  beforeEach(() => {
    getDestinationSeasonality.mockReset();
    getDestinationSeasonality.mockResolvedValue({
      data: { insights: [insight(4, { stale: true }), insight(5)] },
      meta: { requestId },
    });
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
  });

  afterEach(cleanup);

  test("explains monthly signals and updates advice when priorities change", async () => {
    render(createElement(BestTimeCalendar, { placeId }));

    expect(await screen.findByRole("heading", { name: "Compare the tradeoffs" })).toBeDefined();
    expect(screen.getByRole("button", { name: /Apr.*Mixed signals/i })).toBeDefined();
    expect(screen.getByText("Sources conflict")).toBeDefined();
    expect(screen.getByText("Needs refresh")).toBeDefined();
    expect(screen.getByText("Not available")).toBeDefined();
    expect(screen.getByText(/Qualitative price evidence indicates a tradeoff/i)).toBeDefined();

    screen.getByRole("tab", { name: "Months" }).focus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Months" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Flexible dates" }).getAttribute("aria-selected")).toBe(
      "true",
    );

    fireEvent.change(screen.getByRole("slider", { name: /Weather/i }), { target: { value: "5" } });

    await waitFor(() => {
      expect(getDestinationSeasonality).toHaveBeenLastCalledWith(placeId, {
        budget: 1,
        closures: 1,
        crowds: 1,
        festivals: 1,
        weather: 5,
      });
    });
  });

  test("compares a flexible range with accessible controls and text alternatives", async () => {
    const { container } = render(createElement(BestTimeCalendar, { placeId }));
    await screen.findByRole("heading", { name: "Compare the tradeoffs" });

    fireEvent.click(screen.getByRole("tab", { name: "Flexible dates" }));
    const panel = screen.getByRole("tabpanel", { name: "Flexible dates" });
    fireEvent.change(within(panel).getByLabelText("Start date"), {
      target: { value: "2027-04-01" },
    });
    fireEvent.change(within(panel).getByLabelText("End date"), { target: { value: "2027-05-31" } });

    expect(await within(panel).findByText(/Comparing 2 evidence periods/i)).toBeDefined();
    expect(within(panel).getByRole("button", { name: /April 2027.*Mixed signals/i })).toBeDefined();

    const result = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations).toHaveLength(0);
  });

  test("keeps the boundary explicit when seasonal evidence is unavailable", async () => {
    getDestinationSeasonality.mockResolvedValue({ data: { insights: [] }, meta: { requestId } });
    render(createElement(BestTimeCalendar, { placeId }));

    expect(
      await screen.findByRole("heading", { name: "Seasonal guide still under review" }),
    ).toBeDefined();
  });
});
