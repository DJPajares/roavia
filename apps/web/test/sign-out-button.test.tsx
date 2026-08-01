// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const clearOfflinePackages = vi.hoisted(() => vi.fn<(ownerId: string) => Promise<void>>());
const signOut = vi.hoisted(() => vi.fn<() => Promise<void>>());

vi.mock("@roavia/offline/browser", () => ({ clearOfflinePackages }));
vi.mock("../app/auth/actions", () => ({ signOut }));

import { SignOutButton } from "../components/sign-out-button";

const ownerId = "11111111-1111-4111-8111-111111111111";

describe("SignOutButton", () => {
  afterEach(cleanup);

  beforeEach(() => {
    clearOfflinePackages.mockReset();
    signOut.mockReset();
    clearOfflinePackages.mockResolvedValue();
    signOut.mockResolvedValue();
    Object.defineProperty(globalThis, "caches", {
      configurable: true,
      value: { delete: vi.fn<(cacheName: string) => Promise<boolean>>().mockResolvedValue(true) },
    });
  });

  test("clears the account package and private route cache before signing out", async () => {
    const user = userEvent.setup();
    render(createElement(SignOutButton, { ownerId }));

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
    expect(clearOfflinePackages).toHaveBeenCalledWith(ownerId);
    expect(caches.delete).toHaveBeenCalledWith("roavia-runtime-v2");
    expect(clearOfflinePackages.mock.invocationCallOrder[0]).toBeLessThan(
      signOut.mock.invocationCallOrder[0] ?? 0,
    );
  });

  test("keeps the session active when private offline data cannot be cleared", async () => {
    clearOfflinePackages.mockRejectedValue(new Error("Storage unavailable"));
    const user = userEvent.setup();
    render(createElement(SignOutButton, { ownerId }));

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByText(/could not safely clear/)).toBeDefined();
    expect(signOut).not.toHaveBeenCalled();
  });
});
