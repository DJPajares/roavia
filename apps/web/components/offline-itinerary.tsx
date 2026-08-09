"use client";

import type { OfflinePackageManifest } from "@roavia/contracts";
import type { StoredOfflinePackage } from "@roavia/offline/browser";
import { ExperienceState, TrustNotice } from "@roavia/ui";
import Link from "next/link";
import { useState } from "react";

import { OfflinePackageControls } from "./offline-package-controls";

function formatDate(value: string, options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) {
  return new Intl.DateTimeFormat("en", { ...options, timeZone: "UTC" }).format(
    new Date(`${value}T12:00:00.000Z`),
  );
}

function formatTime(value: string | null) {
  if (!value) return "Flexible time";
  const [hours = "0", minutes = "00"] = value.split(":");
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(
    new Date(2000, 0, 1, Number(hours), Number(minutes)),
  );
}

function labelFor(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}

function guidanceValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(guidanceValue).join(", ");
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, child]) => `${labelFor(key)}: ${guidanceValue(child)}`)
      .join(" · ");
  }
  return "Not provided";
}

function OfflineDays({ manifest }: Readonly<{ manifest: OfflinePackageManifest }>) {
  return (
    <div className="offline-itinerary-days">
      {manifest.trip.days.map((day, dayIndex) => (
        <section className="offline-itinerary-day" key={day.id}>
          <header>
            <p>{formatDate(day.localDate, { dateStyle: "full" })}</p>
            <h2>{day.title ?? `Day ${dayIndex + 1}`}</h2>
            {day.notes ? <span>{day.notes}</span> : null}
          </header>
          {day.items.length > 0 ? (
            <ol>
              {day.items.map((item) => (
                <li key={item.id}>
                  <div className="offline-itinerary-item__time">
                    <strong>{formatTime(item.startTime)}</strong>
                    {item.endTime ? <span>to {formatTime(item.endTime)}</span> : null}
                  </div>
                  <div>
                    <p className="eyebrow">{labelFor(item.itemType)}</p>
                    <h3>{item.place?.name ?? labelFor(item.itemType)}</h3>
                    {item.place?.address ? <address>{item.place.address}</address> : null}
                    {item.place?.coordinates ? (
                      <p className="offline-itinerary-item__coordinates">
                        Coordinates {item.place.coordinates.latitude.toFixed(4)},{" "}
                        {item.place.coordinates.longitude.toFixed(4)}
                      </p>
                    ) : null}
                    {item.notes ? <p>{item.notes}</p> : null}
                    <span className="offline-itinerary-item__boundary">
                      Booking availability unavailable offline
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="offline-itinerary-day__empty">
              No itinerary items were saved for this day.
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

function OfflineGuidance({ manifest }: Readonly<{ manifest: OfflinePackageManifest }>) {
  return (
    <section aria-labelledby="offline-guidance-heading" className="offline-guidance">
      <div className="offline-guidance__heading">
        <p className="eyebrow">Destination essentials</p>
        <h2 id="offline-guidance-heading">Guidance saved with this trip</h2>
      </div>
      {manifest.guidance.length > 0 ? (
        <div className="offline-guidance__list">
          {manifest.guidance.map((record) => (
            <article key={`${record.placeId}-${record.contentType}`}>
              <div className="offline-guidance__status">
                <span>{labelFor(record.contentType)}</span>
                <span>
                  {record.freshness === "stale"
                    ? "Saved guidance · stale"
                    : "Saved guidance · current at download"}
                </span>
              </div>
              <dl>
                {Object.entries(record.data).map(([key, value]) => (
                  <div key={key}>
                    <dt>{labelFor(key)}</dt>
                    <dd>{guidanceValue(value)}</dd>
                  </div>
                ))}
              </dl>
              <div className="offline-guidance__sources">
                <strong>Sources</strong>
                {record.sources.map((source) => (
                  <a
                    href={source.url}
                    key={`${source.url}-${source.retrievedAt}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {source.title ?? source.attribution ?? new URL(source.url).hostname}
                  </a>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <ExperienceState
          detail="This package contains the itinerary, but no destination guidance was eligible for offline redistribution."
          state="empty"
          title="No offline guidance in this version"
        />
      )}
    </section>
  );
}

export function OfflineItinerary({
  initialPackage,
  ownerId,
}: Readonly<{ initialPackage: StoredOfflinePackage; ownerId: string }>) {
  const [available, setAvailable] = useState(true);
  const [savedPackage, setSavedPackage] = useState(initialPackage);
  const manifest = savedPackage.record.manifest;

  if (!available) {
    return (
      <ExperienceState
        action={
          <Link className="roavia-button roavia-button--quiet" href="/trips">
            Return to trips
          </Link>
        }
        detail="Reconnect to download this trip again. The online itinerary has not been removed."
        headingLevel={1}
        state="offline"
        title="Offline package removed"
      />
    );
  }

  return (
    <section aria-labelledby="offline-itinerary-heading" className="offline-itinerary">
      <Link className="itinerary-workspace__back" href="/offline">
        ← Offline downloads
      </Link>
      <header className="offline-itinerary__hero">
        <div>
          <p className="eyebrow">Offline itinerary · package {savedPackage.record.version}</p>
          <h1 id="offline-itinerary-heading">{manifest.trip.title}</h1>
          <p>
            {formatDate(manifest.trip.startDate)} – {formatDate(manifest.trip.endDate)}
          </p>
        </div>
        <span>Saved on this device</span>
      </header>

      <output className="itinerary-workspace__notice is-offline">
        You are viewing the downloaded package. Weather, closures, live prices, booking
        availability, and assistant answers are unavailable offline.
      </output>

      <OfflinePackageControls
        initialPackage={savedPackage}
        onRemoved={() => setAvailable(false)}
        onStored={setSavedPackage}
        ownerId={ownerId}
        tripId={manifest.trip.id}
        tripRevision={manifest.trip.revision}
      />
      <OfflineDays manifest={manifest} />
      <OfflineGuidance manifest={manifest} />
      <TrustNotice label="Offline boundary">
        Saved source links may require a connection to open. Review current official advice after
        reconnecting, especially for safety and emergency information.
      </TrustNotice>
    </section>
  );
}
