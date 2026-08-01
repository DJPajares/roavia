// @vitest-environment jsdom

import { readFile } from "node:fs/promises";

import { cleanup, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import manifest from "../app/manifest";
import { PwaRegistration } from "../components/pwa-registration";

describe("Roavia PWA shell", () => {
  afterEach(cleanup);

  test("declares a standalone installable manifest", () => {
    expect(manifest()).toMatchObject({
      display: "standalone",
      icons: expect.arrayContaining([
        expect.objectContaining({
          sizes: "192x192",
          src: "/pwa-icon-192",
          type: "image/png",
        }),
        expect.objectContaining({
          sizes: "512x512",
          src: "/pwa-icon-512",
          type: "image/png",
        }),
      ]),
      name: "Roavia Travel Planner",
      scope: "/",
      short_name: "Roavia",
      start_url: "/trips",
    });
  });

  test("registers the application service worker", async () => {
    const register = vi
      .fn<(scriptURL: string | URL, options?: RegistrationOptions) => Promise<unknown>>()
      .mockResolvedValue({});
    Object.defineProperty(window.navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    });

    render(createElement(PwaRegistration));

    await waitFor(() => expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" }));
  });

  test("keeps cached routes and the last usable package as separate atomic layers", async () => {
    const worker = await readFile("public/sw.js", "utf8");

    expect(worker).toContain("CACHE_OFFLINE_ROUTES");
    expect(worker).toContain("cacheRouteAndAssets");
    expect(worker).toContain("OFFLINE_ROUTES_CACHED");
    expect(worker).toContain('request.mode === "navigate"');
    expect(worker).toContain("controller.abort()");
    expect(worker).toContain('caches.match("/offline")');
    expect(worker).not.toContain("offline-package");
  });
});
