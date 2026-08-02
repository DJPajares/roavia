// @vitest-environment jsdom

import axe from "axe-core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({
  confirmAccountDeletion: vi.fn<() => Promise<unknown>>(),
  createAccountExport: vi.fn<() => Promise<unknown>>(),
  downloadAccountExport: vi.fn<() => Promise<unknown>>(),
  previewAccountDeletion: vi.fn<() => Promise<unknown>>(),
}));
const auth = vi.hoisted(() => ({
  getSession: vi.fn<() => Promise<{ data: { session: { access_token: string } } }>>(async () => ({
    data: { session: { access_token: "access-token" } },
  })),
  signInWithPassword: vi.fn<
    (input: { email: string; password: string }) => Promise<{ error: null }>
  >(async () => ({ error: null })),
  signOut: vi.fn<(input: { scope: "local" }) => Promise<{ error: null }>>(async () => ({
    error: null,
  })),
}));
const clearOfflinePackages = vi.hoisted(() =>
  vi.fn<(ownerId: string) => Promise<void>>(async () => undefined),
);

vi.mock("@roavia/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@roavia/api-client")>()),
  createRoaviaApiClient: () => api,
}));

vi.mock("@roavia/offline/browser", () => ({ clearOfflinePackages }));

vi.mock("../lib/supabase/client", () => ({ createClient: () => ({ auth }) }));

import { AccountPrivacyControls } from "../components/account-privacy-controls";

const preview = {
  assistantRecords: 1,
  backupDeletionBy: "2026-09-02T00:00:00.000Z",
  exportArtifacts: 0,
  immediateEffects: ["All Roavia sessions and share links are revoked."],
  liveDeletionBy: "2026-08-03T00:00:00.000Z",
  offlinePackages: 1,
  pendingJobs: 1,
  retainedEvidence: ["A content-free deletion receipt is retained for 12 months."],
  shareLinks: 1,
  trips: 2,
};
const receipt = {
  backupDeletionBy: preview.backupDeletionBy,
  completedAt: "2026-08-02T00:01:00.000Z",
  confirmedAt: "2026-08-02T00:00:00.000Z",
  failureCodes: [],
  liveDeletionBy: preview.liveDeletionBy,
  policyVersion: "2026-07-28.v1",
  receiptId: "33333333-3333-4333-8333-333333333333",
  status: "completed",
  steps: {
    authIdentityDeletion: "succeeded",
    jobCancellation: "succeeded",
    liveDataDeletion: "succeeded",
    sessionRevocation: "succeeded",
  },
};

describe("AccountPrivacyControls", () => {
  beforeEach(() => {
    api.previewAccountDeletion.mockResolvedValue({ data: preview });
    api.createAccountExport.mockReset();
    api.downloadAccountExport.mockReset();
    api.confirmAccountDeletion.mockReset();
    auth.signInWithPassword.mockClear();
    auth.signOut.mockClear();
    clearOfflinePackages.mockClear();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn<() => string>(() => "blob:export"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn<(url: string) => void>(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, "caches");
  });

  test("reauthenticates and downloads an expiring export without exposing the password", async () => {
    api.createAccountExport.mockResolvedValue({
      data: {
        createdAt: "2026-08-02T00:00:00.000Z",
        expiresAt: "2026-08-02T23:00:00.000Z",
        exportId: "22222222-2222-4222-8222-222222222222",
        grantToken: "g".repeat(43),
        sizeBytes: 42,
      },
    });
    api.downloadAccountExport.mockResolvedValue({
      blob: new Blob(["zip"]),
      filename: "roavia-account-export.zip",
    });
    const user = userEvent.setup();
    render(
      createElement(AccountPrivacyControls, {
        email: "traveler@roavia.test",
        ownerId: "owner-1",
      }),
    );

    expect(await screen.findByText("2 trips")).toBeDefined();
    await user.type(screen.getByLabelText("Current password"), "secure-password");
    await user.click(screen.getByRole("button", { name: "Create secure export" }));

    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "traveler@roavia.test",
      password: "secure-password",
    });
    expect(api.createAccountExport).toHaveBeenCalledWith();
    expect(api.downloadAccountExport).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      "g".repeat(43),
    );
    expect(await screen.findByText(/encrypted export is ready/i)).toBeDefined();
  });

  test("requires exact confirmation then clears offline data and signs out", async () => {
    api.confirmAccountDeletion.mockResolvedValue({ data: receipt });
    const cacheDelete = vi.fn<(name: string) => Promise<boolean>>(async () => true);
    Object.defineProperty(globalThis, "caches", {
      configurable: true,
      value: { delete: cacheDelete },
    });
    const user = userEvent.setup();
    render(
      createElement(AccountPrivacyControls, {
        email: "traveler@roavia.test",
        ownerId: "owner-1",
      }),
    );

    await screen.findByText("2 trips");
    const deleteButton = screen.getByRole("button", { name: "Delete account permanently" });
    expect((deleteButton as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText("Current password"), "secure-password");
    await user.type(screen.getByLabelText("Type DELETE to confirm"), "delete");
    expect((deleteButton as HTMLButtonElement).disabled).toBe(true);
    await user.clear(screen.getByLabelText("Type DELETE to confirm"));
    await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await user.click(deleteButton);

    expect(api.confirmAccountDeletion).toHaveBeenCalledWith({ confirmation: "DELETE" });
    expect(clearOfflinePackages).toHaveBeenCalledWith("owner-1");
    expect(cacheDelete).toHaveBeenCalledWith("roavia-runtime-v2");
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(await screen.findByText(/account is deleted, all sessions are revoked/i)).toBeDefined();
    expect(screen.getByRole("heading", { name: "Deletion receipt" })).toBeDefined();
  });

  test("has no detectable accessibility violations", async () => {
    const rendered = render(
      createElement(AccountPrivacyControls, {
        email: "traveler@roavia.test",
        ownerId: "owner-1",
      }),
    );

    await screen.findByText("2 trips");
    expect((await axe.run(rendered.container)).violations).toEqual([]);
  });
});
