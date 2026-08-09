"use client";

import { createRoaviaApiClient } from "@roavia/api-client";
import type { SeasonalCollectionResponse, Trip } from "@roavia/contracts";
import { Button, ExperienceState, TrustNotice } from "@roavia/ui";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { roaviaApi } from "../lib/api";
import { createClient } from "../lib/supabase/client";
import { DestinationSearch } from "./destination-search";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";
type CollectionState = "error" | "loading" | "offline" | "ready";
type TripsState = "error" | "loading" | "ready";

const intentEntries = [
  [
    "◒",
    "Plan around a feeling",
    "Give us the pace, constraints, and moments that matter. Every choice stays editable.",
  ],
  [
    "◌",
    "Compare the trade-offs",
    "Start from a practical question: weather, cost, crowding, or a specific date window.",
  ],
  [
    "↗",
    "Build from a destination",
    "Bring a place you already love. Roavia keeps its geography and sources in view.",
  ],
] as const;

function formatDate(date: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00.000Z`),
  );
}

function formatPeriod(period: { endDate: string; startDate: string }) {
  const formatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  return `${formatter.format(new Date(`${period.startDate}T12:00:00.000Z`))} – ${formatter.format(new Date(`${period.endDate}T12:00:00.000Z`))}`;
}

function freshnessLabel(
  freshness: SeasonalCollectionResponse["data"]["collections"][number]["freshness"],
) {
  return freshness === "fresh"
    ? "Current"
    : freshness === "stale"
      ? "Needs a refresh"
      : "Sources incomplete";
}

function tripPath(trip: Trip) {
  return trip.status === "draft"
    ? `/plan?tripId=${encodeURIComponent(trip.id)}`
    : `/trips/${trip.id}`;
}

export function ExploreHome({ isSignedIn }: Readonly<{ isSignedIn: boolean }>) {
  const [collections, setCollections] = useState<SeasonalCollectionResponse["data"]["collections"]>(
    [],
  );
  const [collectionState, setCollectionState] = useState<CollectionState>("loading");
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripsState, setTripsState] = useState<TripsState>("loading");
  const api = useMemo(
    () =>
      createRoaviaApiClient({
        accessToken: async () =>
          (await createClient().auth.getSession()).data.session?.access_token ?? null,
        baseUrl: apiBaseUrl,
      }),
    [],
  );

  const loadCollections = useCallback(async () => {
    if (!navigator.onLine) {
      setCollectionState("offline");
      return;
    }
    setCollectionState("loading");
    try {
      const response = await roaviaApi.listSeasonalCollections();
      setCollections(response.data.collections);
      setCollectionState("ready");
    } catch {
      setCollectionState("error");
    }
  }, []);

  useEffect(() => {
    void loadCollections();
    const showOffline = () => setCollectionState("offline");
    const reload = () => void loadCollections();
    window.addEventListener("offline", showOffline);
    window.addEventListener("online", reload);
    return () => {
      window.removeEventListener("offline", showOffline);
      window.removeEventListener("online", reload);
    };
  }, [loadCollections]);

  useEffect(() => {
    if (!isSignedIn) {
      setTripsState("ready");
      return;
    }
    let active = true;
    async function loadTrips() {
      try {
        const response = await api.listTrips({ limit: 6 });
        if (!active) return;
        const today = new Date().toISOString().slice(0, 10);
        setTrips(
          response.data.trips
            .filter(
              (trip) =>
                trip.status === "draft" || (trip.status === "active" && trip.endDate >= today),
            )
            .slice(0, 3),
        );
        setTripsState("ready");
      } catch {
        if (active) setTripsState("error");
      }
    }
    void loadTrips();
    return () => {
      active = false;
    };
  }, [api, isSignedIn]);

  return (
    <div className="explore-home">
      <DestinationSearch />
      <section aria-labelledby="explore-intents-heading" className="explore-home__intents">
        <div className="explore-home__section-heading">
          <p className="eyebrow">Choose an entry point</p>
          <h2 id="explore-intents-heading">Start with what you want from the trip.</h2>
        </div>
        <div className="explore-home__intent-grid">
          {intentEntries.map(([symbol, label, detail]) => (
            <Link className="explore-intent" href="/plan" key={label}>
              <span aria-hidden="true">{symbol}</span>
              <h3>{label}</h3>
              <p>{detail}</p>
              <strong>
                Start planning <span aria-hidden="true">↗</span>
              </strong>
            </Link>
          ))}
        </div>
      </section>
      <section aria-labelledby="seasonal-collections-heading" className="explore-home__seasonal">
        <div className="explore-home__section-heading">
          <p className="eyebrow">Seasonal context</p>
          <h2 id="seasonal-collections-heading">What the current evidence can tell you.</h2>
          <p>These are source-backed planning notes, not a hidden ranking of places.</p>
        </div>
        {collectionState === "loading" ? (
          <ExperienceState
            className="explore-home__state"
            detail="Collecting the latest destination context."
            state="loading"
            title="Loading seasonal collections"
          />
        ) : null}
        {collectionState === "offline" ? (
          <ExperienceState
            className="explore-home__state"
            detail="Reconnect to see source-backed seasonal notes. Destination search is ready when you are back online."
            state="offline"
            title="Seasonal collections need a connection"
          />
        ) : null}
        {collectionState === "error" ? (
          <ExperienceState
            action={
              <Button onClick={() => void loadCollections()} tone="quiet">
                Try again
              </Button>
            }
            className="explore-home__state"
            detail="The seasonal data provider is unavailable. No trip or destination information has changed."
            state="error"
            title="Seasonal collections are unavailable"
          />
        ) : null}
        {collectionState === "ready" && collections.length === 0 ? (
          <ExperienceState
            className="explore-home__state"
            detail="Roavia has no publishable seasonal collections yet. Search a supported destination to begin with its grounded guide."
            state="empty"
            title="Seasonal collections are being prepared"
          />
        ) : null}
        {collectionState === "ready" && collections.length > 0 ? (
          <div className="explore-home__collection-grid">
            {collections.map((collection) => (
              <article
                className="seasonal-collection"
                key={`${collection.destination.id}-${collection.period.startDate}`}
              >
                <div className="seasonal-collection__topline">
                  <span>{collection.destination.type}</span>
                  <span className={`seasonal-collection__freshness is-${collection.freshness}`}>
                    {freshnessLabel(collection.freshness)}
                  </span>
                </div>
                <h3>{collection.destination.name}</h3>
                <p className="seasonal-collection__period">{formatPeriod(collection.period)}</p>
                <p>{collection.reason}</p>
                {collection.tradeoffs[0] ? (
                  <p className="seasonal-collection__tradeoff">
                    Consider: {collection.tradeoffs[0]}
                  </p>
                ) : null}
                <footer>
                  <span>Updated {formatDate(collection.refreshedAt)}</span>
                  {collection.sources[0] ? (
                    <a href={collection.sources[0].url} rel="noreferrer" target="_blank">
                      {collection.sources[0].title ?? "View source"}
                    </a>
                  ) : (
                    <span>Source details are incomplete.</span>
                  )}
                </footer>
              </article>
            ))}
          </div>
        ) : null}
      </section>
      <section aria-labelledby="continue-planning-heading" className="explore-home__continue">
        <div className="explore-home__section-heading">
          <p className="eyebrow">Your next move</p>
          <h2 id="continue-planning-heading">Continue with intention.</h2>
        </div>
        {!isSignedIn ? (
          <ExperienceState
            action={
              <Link className="explore-home__sign-in" href="/auth/sign-in?next=%2F">
                Sign in to continue
              </Link>
            }
            className="explore-home__state"
            detail="Sign in to safely resume drafts and see upcoming trips. Public destination research remains available here."
            state="permission"
            title="Your plans stay private"
          />
        ) : null}
        {isSignedIn && tripsState === "loading" ? (
          <ExperienceState
            className="explore-home__state"
            detail="Looking for drafts and upcoming plans."
            state="loading"
            title="Loading your trips"
          />
        ) : null}
        {isSignedIn && tripsState === "error" ? (
          <ExperienceState
            action={
              <Link className="explore-home__sign-in" href="/trips">
                Open trips
              </Link>
            }
            className="explore-home__state"
            detail="We could not retrieve your trip summary. Your plans are unchanged."
            state="error"
            title="Your trip summary is unavailable"
          />
        ) : null}
        {isSignedIn && tripsState === "ready" && trips.length === 0 ? (
          <ExperienceState
            action={
              <Link className="explore-home__sign-in" href="/plan">
                Start a plan
              </Link>
            }
            className="explore-home__state"
            detail="When you save a draft or upcoming trip, it will appear here for a quick return."
            state="empty"
            title="No drafts or upcoming trips"
          />
        ) : null}
        {isSignedIn && tripsState === "ready" && trips.length > 0 ? (
          <div className="explore-home__trip-list">
            {trips.map((trip) => (
              <Link className="explore-trip" href={tripPath(trip)} key={trip.id}>
                <span>{trip.status === "draft" ? "Draft in progress" : "Upcoming trip"}</span>
                <strong>{trip.title}</strong>
                <small>
                  {formatDate(trip.startDate)} – {formatDate(trip.endDate)}
                </small>
                <b>
                  {trip.status === "draft" ? "Resume" : "Open"} <span aria-hidden="true">↗</span>
                </b>
              </Link>
            ))}
          </div>
        ) : null}
      </section>
      <TrustNotice label="How Explore works">
        Roavia shows destination context with its source and refresh date. Your plans only appear
        after you sign in, and no discovery note changes an itinerary on its own.
      </TrustNotice>
    </div>
  );
}
