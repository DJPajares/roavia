"use client";

import { createRoaviaApiClient } from "@roavia/api-client";
import {
  assertStorageCapacity,
  estimateOfflineStorage,
  getOfflinePackage,
  OfflineStorageError,
  removeOfflinePackage,
  saveOfflinePackage,
  type StoredOfflinePackage,
} from "@roavia/offline/browser";
import { Button } from "@roavia/ui";
import { useEffect, useMemo, useRef, useState } from "react";

import { createClient } from "../lib/supabase/client";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

type Operation = "downloading" | "idle" | "removing";

function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function isCancelled(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof OfflineStorageError && error.code === "cancelled")
  );
}

async function cacheOfflineRoutes(tripId: string) {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const worker = registration.active ?? registration.waiting;
  if (!worker) return;

  await new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    const finish = () => {
      window.clearTimeout(timeout);
      channel.port1.close();
      resolve();
    };
    const timeout = window.setTimeout(finish, 10_000);
    channel.port1.addEventListener("message", finish, { once: true });
    channel.port1.start();
    worker.postMessage(
      {
        routes: ["/offline", `/trips/${encodeURIComponent(tripId)}`],
        type: "CACHE_OFFLINE_ROUTES",
      },
      [channel.port2],
    );
  });
}

export function OfflinePackageControls({
  initialPackage = null,
  onRemoved,
  onStored,
  ownerId,
  tripId,
  tripRevision,
}: Readonly<{
  initialPackage?: StoredOfflinePackage | null;
  onRemoved?: () => void;
  onStored?: (value: StoredOfflinePackage) => void;
  ownerId: string;
  tripId: string;
  tripRevision: number;
}>) {
  const [stored, setStored] = useState<StoredOfflinePackage | null>(initialPackage);
  const [operation, setOperation] = useState<Operation>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [online, setOnline] = useState(true);
  const abortController = useRef<AbortController | null>(null);
  const api = useMemo(
    () =>
      createRoaviaApiClient({
        accessToken: async () =>
          (await createClient().auth.getSession()).data.session?.access_token ?? null,
        baseUrl: apiBaseUrl,
      }),
    [],
  );

  useEffect(() => {
    let active = true;
    if (!initialPackage) {
      void getOfflinePackage(ownerId, tripId)
        .then((value) => {
          if (active) setStored(value);
          return undefined;
        })
        .catch((storageError: unknown) => {
          if (!active) return;
          setError(true);
          setMessage(
            storageError instanceof Error
              ? storageError.message
              : "Offline storage is unavailable in this browser.",
          );
        });
    }
    return () => {
      active = false;
      abortController.current?.abort();
    };
  }, [initialPackage, ownerId, tripId]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const expired = Boolean(
    stored?.record.expiresAt && stored.record.expiresAt < new Date().toISOString(),
  );
  const stale = Boolean(
    stored && (stored.record.manifest.trip.revision !== tripRevision || expired),
  );

  async function download() {
    if (operation !== "idle" || !online) return;
    const controller = new AbortController();
    abortController.current = controller;
    setOperation("downloading");
    setProgress(15);
    setError(false);
    setMessage("Preparing a source-aware package for this trip.");

    try {
      const response = await api.createOfflinePackage(tripId, { signal: controller.signal });
      setProgress(65);
      setMessage("Checking device storage before the package is saved.");
      const estimate = await estimateOfflineStorage();
      const replacementCredit = stored?.record.sizeBytes ?? 0;
      assertStorageCapacity(
        estimate,
        Math.max(0, response.data.package.sizeBytes - replacementCredit),
      );
      setProgress(85);
      const saved = await saveOfflinePackage(ownerId, response.data.package, {
        signal: controller.signal,
      });
      setStored(saved);
      onStored?.(saved);
      setProgress(100);
      setMessage(
        response.data.reused
          ? "The current package is saved on this device."
          : "Offline package saved. Itinerary essentials are ready without a connection.",
      );
      await cacheOfflineRoutes(tripId);
    } catch (downloadError) {
      setError(true);
      if (isCancelled(downloadError)) {
        setMessage(
          stored
            ? "Refresh cancelled. The previous offline package is still available."
            : "Download cancelled. No partial package was saved.",
        );
      } else if (
        downloadError instanceof OfflineStorageError &&
        downloadError.code === "quota_exceeded"
      ) {
        setMessage(
          stored
            ? "This device is short on storage. The previous offline package is still available."
            : "This device is short on storage. Free some space, then retry the download.",
        );
      } else {
        setMessage(
          downloadError instanceof Error
            ? `Offline sync failed: ${downloadError.message}`
            : "Offline sync failed. Retry when the connection is stable.",
        );
      }
    } finally {
      abortController.current = null;
      setOperation("idle");
    }
  }

  async function remove() {
    if (operation !== "idle") return;
    setOperation("removing");
    setError(false);
    try {
      await removeOfflinePackage(ownerId, tripId);
      setStored(null);
      setConfirmRemove(false);
      setMessage("Offline package removed from this device. The online trip is unchanged.");
      onRemoved?.();
    } catch (removeError) {
      setError(true);
      setMessage(
        removeError instanceof Error
          ? removeError.message
          : "The offline package could not be removed.",
      );
    } finally {
      setOperation("idle");
    }
  }

  return (
    <section aria-labelledby={`offline-package-${tripId}`} className="offline-package-panel">
      <div className="offline-package-panel__heading">
        <div>
          <p className="eyebrow">Offline access</p>
          <h2 id={`offline-package-${tripId}`}>
            {stored ? "Saved on this device" : "Take this itinerary with you"}
          </h2>
        </div>
        {stored ? (
          <span className={stale ? "offline-package-status is-stale" : "offline-package-status"}>
            {stale ? "Refresh available" : "Current package"}
          </span>
        ) : null}
      </div>

      {stored ? (
        <dl className="offline-package-metadata">
          <div>
            <dt>Version</dt>
            <dd>{stored.record.version}</dd>
          </div>
          <div>
            <dt>Last update</dt>
            <dd>{formatTimestamp(stored.record.generatedAt)}</dd>
          </div>
          <div>
            <dt>Package size</dt>
            <dd>{formatBytes(stored.record.sizeBytes)}</dd>
          </div>
        </dl>
      ) : (
        <p className="offline-package-panel__intro">
          Save itinerary days, addresses, notes, coordinates, and permitted destination guidance.
        </p>
      )}

      <p className="offline-package-panel__limits">
        Weather, closures, live prices, booking availability, and assistant answers need a
        connection.
      </p>

      {operation === "downloading" ? (
        <div className="offline-package-progress">
          <label htmlFor={`offline-progress-${tripId}`}>{message}</label>
          <progress id={`offline-progress-${tripId}`} max="100" value={progress}>
            {progress}%
          </progress>
          <Button onClick={() => abortController.current?.abort()} tone="quiet">
            Cancel download
          </Button>
        </div>
      ) : (
        <div className="offline-package-actions">
          <Button disabled={!online || operation !== "idle"} onClick={() => void download()}>
            {stored
              ? error
                ? "Retry refresh"
                : "Refresh package"
              : error
                ? "Retry download"
                : "Download for offline"}
          </Button>
          {stored ? (
            <Button
              disabled={operation !== "idle"}
              onClick={() => setConfirmRemove(true)}
              tone="quiet"
            >
              Remove download
            </Button>
          ) : null}
        </div>
      )}

      {!online ? (
        <p className="offline-package-panel__connection">Reconnect to refresh this package.</p>
      ) : null}
      {message && operation !== "downloading" ? (
        <output
          aria-live="polite"
          className={error ? "offline-package-message is-error" : "offline-package-message"}
        >
          {message}
        </output>
      ) : null}

      {confirmRemove ? (
        <div
          className="offline-package-confirmation"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={`remove-offline-${tripId}`}
        >
          <h3 id={`remove-offline-${tripId}`}>Remove this offline package?</h3>
          <p>The online trip remains saved. This device will need a connection to open it again.</p>
          <div>
            <Button onClick={() => setConfirmRemove(false)} tone="quiet">
              Keep download
            </Button>
            <button className="offline-package-remove" onClick={() => void remove()} type="button">
              {operation === "removing" ? "Removing…" : "Remove from device"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
