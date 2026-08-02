"use client";

import {
  createRoaviaApiClient,
  type AccountDeletionPreviewResponse,
  type AccountDeletionReceipt,
} from "@roavia/api-client";
import { clearOfflinePackages } from "@roavia/offline/browser";
import { Button, ExperienceState, TrustNotice } from "@roavia/ui";
import { useCallback, useEffect, useMemo, useState } from "react";

import { createClient } from "../lib/supabase/client";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";
const offlineRuntimeCache = "roavia-runtime-v2";

type Preview = AccountDeletionPreviewResponse["data"];

function localTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

export function AccountPrivacyControls({
  email,
  ownerId,
}: Readonly<{ email: string | undefined; ownerId: string }>) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewState, setPreviewState] = useState<"error" | "loading" | "ready">("loading");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [operation, setOperation] = useState<"deleting" | "exporting" | null>(null);
  const [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState<AccountDeletionReceipt | null>(null);
  const api = useMemo(
    () =>
      createRoaviaApiClient({
        accessToken: async () =>
          (await createClient().auth.getSession()).data.session?.access_token ?? null,
        baseUrl: apiBaseUrl,
      }),
    [],
  );

  const loadPreview = useCallback(async () => {
    setPreviewState("loading");
    try {
      setPreview((await api.previewAccountDeletion()).data);
      setPreviewState("ready");
    } catch {
      setPreviewState("error");
    }
  }, [api]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  async function reauthenticate() {
    if (!email || password.length < 8) {
      throw new Error("Enter the password for this account before continuing.");
    }
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    if (error) throw new Error("That password was not accepted. Nothing has been changed.");
  }

  async function requestExport() {
    if (operation) return;
    setOperation("exporting");
    setMessage("");
    try {
      await reauthenticate();
      const grant = (await api.createAccountExport()).data;
      const artifact = await api.downloadAccountExport(grant.exportId, grant.grantToken);
      const url = URL.createObjectURL(artifact.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = artifact.filename;
      link.click();
      URL.revokeObjectURL(url);
      setMessage(
        `Your encrypted export is ready. Its download grant expires ${localTime(grant.expiresAt)}.`,
      );
      setPassword("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Roavia could not create your export.");
    } finally {
      setOperation(null);
    }
  }

  async function deleteAccount() {
    if (operation || confirmation !== "DELETE") return;
    setOperation("deleting");
    setMessage("");
    try {
      await reauthenticate();
      const result = (await api.confirmAccountDeletion({ confirmation: "DELETE" })).data;
      setReceipt(result);
      setPassword("");
      if (result.status === "completed") {
        let localCleanupFailed = false;
        try {
          await clearOfflinePackages(ownerId);
          if ("caches" in globalThis) await caches.delete(offlineRuntimeCache);
        } catch {
          localCleanupFailed = true;
        }
        await createClient().auth.signOut({ scope: "local" });
        setMessage(
          localCleanupFailed
            ? "Your server account is deleted. Clear this browser's site data to remove offline copies that could not be reached."
            : "Your account is deleted, all sessions are revoked, and this browser's offline copies are cleared.",
        );
      } else {
        setMessage(
          "Deletion is safely blocked from normal access, but one cleanup step needs a retry. Re-authenticate and retry below.",
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Roavia could not delete your account.");
    } finally {
      setOperation(null);
    }
  }

  if (previewState === "loading" && !preview) {
    return (
      <ExperienceState
        detail="Checking your saved trips, shares, jobs, and offline packages."
        state="loading"
        title="Preparing your privacy controls"
      />
    );
  }
  if (previewState === "error" && !preview) {
    return (
      <ExperienceState
        action={
          <Button onClick={() => void loadPreview()} tone="quiet">
            Try again
          </Button>
        }
        detail="No account data has been changed."
        state="error"
        title="Privacy controls are unavailable"
      />
    );
  }
  if (!preview) return null;

  return (
    <section aria-labelledby="account-privacy-heading" className="account-privacy">
      <div className="account-privacy__intro">
        <p className="eyebrow">Privacy and account</p>
        <h2 id="account-privacy-heading">
          Take your data, or leave without a trace in active use.
        </h2>
        <p>
          Export a machine-readable snapshot or review exactly what account deletion changes now,
          within 24 hours, and after backups expire.
        </p>
      </div>

      <div className="account-privacy__summary" aria-label="Account data summary">
        <span>{preview.trips} trips</span>
        <span>{preview.shareLinks} share links</span>
        <span>{preview.offlinePackages} offline packages</span>
        <span>{preview.pendingJobs} pending jobs</span>
      </div>

      {receipt ? (
        <div aria-live="polite" className="account-privacy__receipt">
          <h3>Deletion receipt</h3>
          <p>
            Receipt <strong>{receipt.receiptId}</strong>
          </p>
          <p>
            Status: <strong>{receipt.status}</strong>. Live deletion deadline:{" "}
            {localTime(receipt.liveDeletionBy)}. Backup expiry deadline:{" "}
            {localTime(receipt.backupDeletionBy)}.
          </p>
          <ul>
            {Object.entries(receipt.steps).map(([step, state]) => (
              <li key={step}>
                {step}: {state}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {receipt?.status !== "completed" ? (
        <div className="account-privacy__controls">
          <label>
            Current password
            <input
              autoComplete="current-password"
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </label>
          <p className="account-privacy__hint">
            Roavia verifies your password with the identity provider. It is never sent to the Roavia
            API or stored in your export.
          </p>

          <div className="account-privacy__export">
            <div>
              <h3>Download your account data</h3>
              <p>
                The ZIP contains versioned JSON, CSV convenience files, checksums, and no passwords,
                access tokens, share tokens, or provider credentials.
              </p>
            </div>
            <Button
              disabled={operation !== null || password.length < 8}
              onClick={() => void requestExport()}
            >
              {operation === "exporting" ? "Preparing export…" : "Create secure export"}
            </Button>
          </div>

          <div className="account-privacy__danger">
            <div>
              <h3>Delete this account</h3>
              <ul>
                {preview.immediateEffects.map((effect) => (
                  <li key={effect}>{effect}</li>
                ))}
                {preview.retainedEvidence.map((effect) => (
                  <li key={effect}>{effect}</li>
                ))}
              </ul>
              <p>
                Active data is deleted by {localTime(preview.liveDeletionBy)}. Backups expire by{" "}
                {localTime(preview.backupDeletionBy)}.
              </p>
            </div>
            <label>
              Type DELETE to confirm
              <input
                autoComplete="off"
                onChange={(event) => setConfirmation(event.target.value)}
                value={confirmation}
              />
            </label>
            <Button
              className="account-privacy__delete-button"
              disabled={operation !== null || password.length < 8 || confirmation !== "DELETE"}
              onClick={() => void deleteAccount()}
              tone="quiet"
            >
              {operation === "deleting"
                ? "Deleting account…"
                : receipt
                  ? "Retry deletion"
                  : "Delete account permanently"}
            </Button>
          </div>
        </div>
      ) : null}

      <p aria-live="polite" className="account-privacy__message">
        {message}
      </p>
      <TrustNotice>
        Export artifacts expire automatically. Content-free deletion evidence is retained for 12
        months so failures can be repaired without restoring your account data.
      </TrustNotice>
    </section>
  );
}
