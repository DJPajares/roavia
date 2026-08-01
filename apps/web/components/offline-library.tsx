"use client";

import {
  estimateOfflineStorage,
  listOfflinePackages,
  removeOfflinePackage,
  type OfflineStorageEstimate,
  type StoredOfflinePackage,
} from "@roavia/offline/browser";
import { Button, ExperienceState, TrustNotice } from "@roavia/ui";
import Link from "next/link";
import { useEffect, useState } from "react";

function formatBytes(value: number | null) {
  if (value === null) return "Not reported by this browser";
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(value < 10_240 ? 1 : 0)} KB`;
  return `${(value / 1_048_576).toFixed(1)} MB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

export function OfflineLibrary({
  email,
  ownerId,
}: Readonly<{ email: string | undefined; ownerId: string }>) {
  const [packages, setPackages] = useState<StoredOfflinePackage[] | null>(null);
  const [storage, setStorage] = useState<OfflineStorageEstimate | null>(null);
  const [message, setMessage] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([listOfflinePackages(ownerId), estimateOfflineStorage()])
      .then(([savedPackages, estimate]) => {
        if (!active) return;
        setPackages(savedPackages);
        setStorage(estimate);
        return undefined;
      })
      .catch((error: unknown) => {
        if (!active) return;
        setPackages([]);
        setMessage(
          error instanceof Error
            ? error.message
            : "Offline storage is unavailable in this browser.",
        );
      });
    return () => {
      active = false;
    };
  }, [ownerId]);

  async function remove(savedPackage: StoredOfflinePackage) {
    setRemoving(savedPackage.tripId);
    setMessage("");
    try {
      await removeOfflinePackage(ownerId, savedPackage.tripId);
      setPackages(
        (current) => current?.filter(({ tripId }) => tripId !== savedPackage.tripId) ?? [],
      );
      setConfirming(null);
      setMessage(`${savedPackage.record.manifest.trip.title} was removed from this device.`);
      setStorage(await estimateOfflineStorage());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The package could not be removed.");
    } finally {
      setRemoving(null);
    }
  }

  if (!packages) {
    return (
      <ExperienceState
        detail="Checking which itinerary packages are stored on this device."
        state="loading"
        title="Loading offline downloads"
      />
    );
  }

  return (
    <section aria-labelledby="offline-library-heading" className="offline-library">
      <div className="offline-library__intro">
        <p className="eyebrow">On this device</p>
        <h1 id="offline-library-heading">Journeys ready beyond the signal.</h1>
        <p>
          Downloaded packages keep itinerary essentials close while making live-data boundaries
          explicit.
        </p>
        {email ? <span>Private offline storage for {email}</span> : null}
      </div>

      <div className="offline-library__actions">
        <Link className="roavia-button roavia-button--quiet" href="/trips">
          Choose another trip
        </Link>
      </div>

      {storage ? (
        <dl className="offline-library__storage">
          <div>
            <dt>Roavia packages</dt>
            <dd>
              {formatBytes(packages.reduce((total, value) => total + value.record.sizeBytes, 0))}
            </dd>
          </div>
          <div>
            <dt>Browser storage used</dt>
            <dd>{formatBytes(storage.usageBytes)}</dd>
          </div>
          <div>
            <dt>Browser storage available</dt>
            <dd>{formatBytes(storage.availableBytes)}</dd>
          </div>
        </dl>
      ) : null}

      {message ? (
        <output aria-live="polite" className="offline-library__message">
          {message}
        </output>
      ) : null}

      {packages.length > 0 ? (
        <div className="offline-library__list">
          {packages.map((savedPackage) => {
            const manifest = savedPackage.record.manifest;
            return (
              <article className="offline-library-card" key={savedPackage.key}>
                <div>
                  <p className="eyebrow">Package {savedPackage.record.version}</p>
                  <h2>{manifest.trip.title}</h2>
                  <p>
                    {manifest.trip.startDate} – {manifest.trip.endDate} ·{" "}
                    {manifest.trip.days.length} days
                  </p>
                </div>
                <dl>
                  <div>
                    <dt>Last update</dt>
                    <dd>{formatDate(savedPackage.record.generatedAt)}</dd>
                  </div>
                  <div>
                    <dt>Size</dt>
                    <dd>{formatBytes(savedPackage.record.sizeBytes)}</dd>
                  </div>
                </dl>
                <div className="offline-library-card__actions">
                  <Link
                    className="roavia-button roavia-button--accent"
                    href={`/trips/${savedPackage.tripId}`}
                  >
                    Open itinerary
                  </Link>
                  <Button onClick={() => setConfirming(savedPackage.tripId)} tone="quiet">
                    Remove
                  </Button>
                </div>
                {confirming === savedPackage.tripId ? (
                  <div
                    aria-labelledby={`remove-library-${savedPackage.tripId}`}
                    aria-modal="true"
                    className="offline-library-card__confirm"
                    role="alertdialog"
                  >
                    <h3 id={`remove-library-${savedPackage.tripId}`}>Remove this download?</h3>
                    <p>The online trip remains saved.</p>
                    <div>
                      <Button onClick={() => setConfirming(null)} tone="quiet">
                        Keep download
                      </Button>
                      <button
                        className="offline-package-remove"
                        disabled={removing === savedPackage.tripId}
                        onClick={() => void remove(savedPackage)}
                        type="button"
                      >
                        {removing === savedPackage.tripId ? "Removing…" : "Remove from device"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <ExperienceState
          action={
            <Link className="roavia-button roavia-button--accent" href="/trips">
              Choose a trip
            </Link>
          }
          detail="Open a saved trip and choose Download for offline. Packages stay scoped to this account on this browser."
          state="empty"
          title="No offline trips yet"
        />
      )}

      <TrustNotice label="Offline privacy">
        Offline packages contain precise travel dates, places, and notes. Remove downloads before
        sharing or disposing of this device.
      </TrustNotice>
    </section>
  );
}
