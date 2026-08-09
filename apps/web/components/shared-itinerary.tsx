"use client";

import { ApiClientError, createRoaviaApiClient } from "@roavia/api-client";
import type { SharedTrip } from "@roavia/contracts";
import { Button, ExperienceState, TrustNotice } from "@roavia/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

function formatDate(value: string, options: Intl.DateTimeFormatOptions) {
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

function itemLabel(item: SharedTrip["days"][number]["items"][number]) {
  return (
    item.sourceSnapshot.place?.name ?? item.itemType.replace(/^./, (letter) => letter.toUpperCase())
  );
}

function unavailableDetail(error: unknown) {
  if (error instanceof ApiClientError && error.status === 404) {
    return "This link is unavailable. It may be invalid, expired, or revoked.";
  }
  return "The shared trip could not be loaded. Check your connection and try again.";
}

export function SharedItinerary({ token }: Readonly<{ token: string }>) {
  const [trip, setTrip] = useState<SharedTrip | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [offline, setOffline] = useState(false);
  const tripRef = useRef<SharedTrip | null>(null);
  const api = useMemo(() => createRoaviaApiClient({ baseUrl: apiBaseUrl }), []);

  const loadTrip = useCallback(async () => {
    if (!tripRef.current) setLoading(true);
    setMessage("");
    try {
      const response = await api.getSharedTrip(token);
      tripRef.current = response.data;
      setTrip(response.data);
    } catch (error) {
      setMessage(unavailableDetail(error));
    } finally {
      setLoading(false);
    }
  }, [api, token]);

  useEffect(() => {
    void loadTrip();
  }, [loadTrip]);

  useEffect(() => {
    const goOnline = () => setOffline(false);
    const goOffline = () => setOffline(true);
    setOffline(!navigator.onLine);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (loading && !trip) {
    return (
      <ExperienceState
        detail="Opening the approved itinerary details from this private link."
        headingLevel={1}
        state="loading"
        title="Loading shared trip"
      />
    );
  }

  if (!trip) {
    return (
      <ExperienceState
        action={
          <Button disabled={offline} onClick={() => void loadTrip()} tone="quiet">
            Try again
          </Button>
        }
        detail={message}
        headingLevel={1}
        state="error"
        title="Shared trip unavailable"
      />
    );
  }

  const stale = trip.days.some((day) =>
    day.items.some(
      (item) =>
        item.sourceSnapshot.source?.freshness === "stale" ||
        (item.route?.availability === "available" && item.route.freshness === "stale"),
    ),
  );

  return (
    <article aria-labelledby="shared-trip-heading" className="shared-trip">
      <header className="shared-trip__header">
        <p className="eyebrow">Read-only trip</p>
        <h1 id="shared-trip-heading">{trip.title}</h1>
        <p>
          {formatDate(trip.startDate, { dateStyle: "medium" })} –{" "}
          {formatDate(trip.endDate, { dateStyle: "medium" })}
        </p>
        <span>
          Link expires{" "}
          {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(trip.expiresAt))}
        </span>
      </header>

      {offline ? (
        <output className="itinerary-workspace__notice is-offline">
          Offline: showing the shared trip already loaded on this device.
        </output>
      ) : null}
      {message ? (
        <output className="itinerary-workspace__notice">
          Refresh failed: {message} The loaded itinerary is unchanged.
        </output>
      ) : null}
      {stale ? (
        <output className="itinerary-workspace__notice is-stale">
          Some saved place or route context is stale. Confirm live details before relying on it.
        </output>
      ) : null}

      <div className="shared-trip__days">
        {trip.days.length > 0 ? (
          trip.days.map((day) => (
            <section className="shared-trip__day" key={`${day.localDate}-${day.orderIndex}`}>
              <header>
                <p>{formatDate(day.localDate, { weekday: "long" })}</p>
                <h2>{day.title ?? formatDate(day.localDate, { dateStyle: "long" })}</h2>
                {day.notes ? <span>{day.notes}</span> : null}
              </header>
              {day.items.length > 0 ? (
                <ol>
                  {day.items.map((item) => (
                    <li key={`${day.localDate}-${item.orderIndex}`}>
                      <time>{formatTime(item.startTime)}</time>
                      <div>
                        <strong>{itemLabel(item)}</strong>
                        {item.sourceSnapshot.place?.address ? (
                          <span>{item.sourceSnapshot.place.address}</span>
                        ) : null}
                        {item.notes ? <p>{item.notes}</p> : null}
                        {item.sourceSnapshot.source ? (
                          <small>
                            Source: {item.sourceSnapshot.source.label} ·{" "}
                            {item.sourceSnapshot.source.freshness}
                          </small>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>No itinerary items were shared for this day.</p>
              )}
            </section>
          ))
        ) : (
          <ExperienceState
            detail="The trip owner has not added itinerary days yet."
            state="empty"
            title="No shared plans yet"
          />
        )}
      </div>

      <TrustNotice label="Read-only boundary">
        This link cannot edit the trip or reveal the owner’s profile, traveler summary, budget, or
        booking metadata. Confirm live hours, routes, prices, and reservations separately.
      </TrustNotice>
    </article>
  );
}
