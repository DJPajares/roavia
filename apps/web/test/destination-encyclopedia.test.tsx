// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, test, vi } from "vitest";

const { getDestination } = vi.hoisted(() => ({
  getDestination: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("../lib/api", () => ({ roaviaApi: { getDestination } }));

import { DestinationEncyclopedia } from "../components/destination-encyclopedia";

const placeId = "33333333-3333-4333-8333-333333333333";

describe("DestinationEncyclopedia", () => {
  test("renders approved practical guidance with freshness and an official source", async () => {
    getDestination.mockResolvedValue({
      data: {
        place: {
          id: placeId,
          canonicalName: "Singapore",
          localizedNames: { zh: "新加坡" },
          placeType: "city",
          countryCode: "SG",
          timezone: "Asia/Singapore",
          summary: "A source-aware guide.",
          hierarchy: [],
        },
        content: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            type: "practical",
            data: { currency: "Singapore dollar" },
            freshness: "fresh",
            refreshedAt: "2026-07-29T00:00:00.000Z",
            sources: [
              {
                id: "55555555-5555-4555-8555-555555555555",
                title: "Visit Singapore",
                url: "https://www.visitsingapore.com/",
                kind: "official_authority",
                attribution: "Source: Visit Singapore",
                license: "official-site-terms",
                licenseUrl: "https://www.visitsingapore.com/terms-of-use/",
                retrievedAt: "2026-07-29T00:00:00.000Z",
              },
            ],
          },
        ],
      },
      meta: { requestId: "66666666-6666-4666-8666-666666666666" },
    });

    render(createElement(DestinationEncyclopedia, { placeId }));

    expect(await screen.findByRole("heading", { name: "Singapore" })).toBeDefined();
    expect(screen.getByText("Currency:")).toBeDefined();
    expect(screen.getByRole("link", { name: "Official source: Visit Singapore" })).toHaveProperty(
      "href",
      "https://www.visitsingapore.com/",
    );
    expect(screen.getByRole("link", { name: "Plan a trip here" }).getAttribute("href")).toBe(
      "/plan",
    );
  });

  test("renders imported rich-content payloads as inert text", async () => {
    getDestination.mockResolvedValue({
      data: {
        place: {
          id: placeId,
          canonicalName: "Singapore",
          localizedNames: {},
          placeType: "city",
          countryCode: "SG",
          timezone: "Asia/Singapore",
          summary: "A source-aware guide.",
          hierarchy: [],
        },
        content: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            type: "practical",
            data: { advisory: '<img src=x onerror="globalThis.compromised=true">' },
            freshness: "fresh",
            refreshedAt: "2026-07-29T00:00:00.000Z",
            sources: [
              {
                id: "55555555-5555-4555-8555-555555555555",
                title: "Official source",
                url: "https://official.example.test/",
                kind: "official_authority",
                attribution: null,
                license: null,
                licenseUrl: null,
                retrievedAt: "2026-07-29T00:00:00.000Z",
              },
            ],
          },
        ],
      },
      meta: { requestId: "66666666-6666-4666-8666-666666666666" },
    });

    const { container } = render(createElement(DestinationEncyclopedia, { placeId }));

    expect(await screen.findByText(/<img src=x onerror=/)).toBeDefined();
    expect(container.querySelector("img")).toBeNull();
    expect((globalThis as { compromised?: boolean }).compromised).toBeUndefined();
  });
});
