"use client";

import { ApiClientError, createRoaviaApiClient } from "@roavia/api-client";
import type { Profile, Trip, TripListData } from "@roavia/contracts";
import { Button, ExperienceState, TrustNotice } from "@roavia/ui";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createClient } from "../lib/supabase/client";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";
const pageSize = 20;

type DashboardState = "error" | "loading" | "ready";
type Lifecycle = "completed" | "draft" | "shared" | "upcoming";
type LifecycleFilter = "all" | Lifecycle;

const lifecycleLabels: Record<Lifecycle, string> = {
  completed: "Completed",
  draft: "Drafts",
  shared: "Shared",
  upcoming: "Upcoming",
};

const lifecycleOrder: Lifecycle[] = ["draft", "upcoming", "shared", "completed"];
const lifecycleFilters: LifecycleFilter[] = ["all", ...lifecycleOrder];

function lifecycleFor(trip: Trip, today: string): Lifecycle {
  if (trip.status === "draft") {
    return "draft";
  }
  if (trip.visibility === "link") {
    return "shared";
  }
  if (trip.status === "archived" || trip.endDate < today) {
    return "completed";
  }
  return "upcoming";
}

function formatDate(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00.000Z`),
  );
}

function formatBudget(trip: Trip, locale: string) {
  if (trip.budget.amountMinor === null) {
    return `${trip.budget.style} planning`;
  }
  return new Intl.NumberFormat(locale, {
    currency: trip.budget.currency,
    style: "currency",
  }).format(trip.budget.amountMinor / 100);
}

function errorMessage(error: unknown) {
  if (error instanceof ApiClientError && error.status === 401) {
    return "Your session has expired. Sign in again to view your trips.";
  }
  return error instanceof Error
    ? error.message
    : "We could not update your trips. Your list is unchanged.";
}

interface TripCardProps {
  locale: string;
  onOpen: (trip: Trip) => void;
  trip: Trip;
}

function TripCard({ locale, onOpen, trip }: Readonly<TripCardProps>) {
  return (
    <article className="trip-card">
      <button
        aria-label={`Open ${trip.title}`}
        className="trip-card__open"
        onClick={() => onOpen(trip)}
        type="button"
      >
        <span className="trip-card__state">
          {trip.status === "draft" ? "In progress" : "Saved trip"}
        </span>
        <strong>{trip.title}</strong>
        <span>
          {formatDate(trip.startDate, locale)} – {formatDate(trip.endDate, locale)}
        </span>
        <span>{formatBudget(trip, locale)}</span>
      </button>
      <span
        aria-label={trip.visibility === "link" ? "Shared by link" : "Private trip"}
        className="trip-card__privacy"
      >
        {trip.visibility === "link" ? "↗ Shared" : "◐ Private"}
      </span>
    </article>
  );
}

interface TripPreviewProps {
  deleting: boolean;
  error: string;
  locale: string;
  onClose: () => void;
  onDelete: (trip: Trip) => void;
  trip: Trip;
}

function TripPreview({
  deleting,
  error,
  locale,
  onClose,
  onDelete,
  trip,
}: Readonly<TripPreviewProps>) {
  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <dialog
      aria-labelledby="trip-preview-title"
      aria-modal="true"
      className="trip-preview"
      onKeyDown={handleDialogKeyDown}
      open
    >
      <div className="trip-preview__sheet">
        <button
          aria-label="Close trip preview"
          autoFocus
          className="trip-preview__close"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
        <p className="eyebrow">Saved trip</p>
        <h2 id="trip-preview-title">{trip.title}</h2>
        <dl className="trip-preview__details">
          <div>
            <dt>Dates</dt>
            <dd>
              {formatDate(trip.startDate, locale)} – {formatDate(trip.endDate, locale)}
            </dd>
          </div>
          <div>
            <dt>Travelers</dt>
            <dd>
              {trip.travelerSummary.adults +
                trip.travelerSummary.children +
                trip.travelerSummary.infants}
            </dd>
          </div>
          <div>
            <dt>Budget</dt>
            <dd>{formatBudget(trip, locale)}</dd>
          </div>
          <div>
            <dt>Sharing</dt>
            <dd>{trip.visibility === "link" ? "Shared by link" : "Private to you"}</dd>
          </div>
        </dl>
        <section className="trip-preview__sharing" aria-labelledby="trip-preview-sharing">
          <h3 id="trip-preview-sharing">Sharing controls</h3>
          <p>
            Link sharing is kept separate from your trip list. It will be available in the trip
            workspace once the dedicated sharing flow is connected.
          </p>
        </section>
        <div className="trip-preview__actions">
          <Link className="roavia-button roavia-button--accent" href={`/trips/${trip.id}`}>
            Open itinerary
          </Link>
          <Link className="roavia-button roavia-button--quiet" href={`/plan?tripId=${trip.id}`}>
            Resume planning
          </Link>
          <Button disabled={deleting} onClick={() => onDelete(trip)}>
            {deleting ? "Removing…" : "Remove trip"}
          </Button>
        </div>
        {error ? (
          <p className="trip-preview__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </dialog>
  );
}

export function TripsDashboard({ email }: Readonly<{ email: string | undefined }>) {
  const [data, setData] = useState<TripListData | null>(null);
  const [filter, setFilter] = useState<LifecycleFilter>("all");
  const [message, setMessage] = useState("");
  const [offline, setOffline] = useState(false);
  const [preferences, setPreferences] = useState<Pick<Profile, "locale" | "timezone">>({
    locale: "en",
    timezone: "UTC",
  });
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [state, setState] = useState<DashboardState>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const dataRef = useRef<TripListData | null>(null);
  const previewReturnFocus = useRef<HTMLElement | null>(null);
  const api = useMemo(
    () =>
      createRoaviaApiClient({
        accessToken: async () =>
          (await createClient().auth.getSession()).data.session?.access_token ?? null,
        baseUrl: apiBaseUrl,
      }),
    [],
  );

  const loadTrips = useCallback(
    async (cursor?: string) => {
      if (cursor) {
        setLoadingMore(true);
      } else {
        setState("loading");
        setMessage("");
      }
      const [tripsResult, profileResult] = await Promise.allSettled([
        api.listTrips({ cursor, limit: pageSize }),
        cursor ? Promise.resolve(null) : api.getProfile(),
      ]);
      if (tripsResult.status === "rejected") {
        setLoadingMore(false);
        if (dataRef.current) {
          setState("ready");
          setMessage(errorMessage(tripsResult.reason));
        } else {
          setState("error");
          setMessage(errorMessage(tripsResult.reason));
        }
        return;
      }
      setData((current) => ({
        pagination: tripsResult.value.data.pagination,
        trips: cursor
          ? [...(current?.trips ?? []), ...tripsResult.value.data.trips]
          : tripsResult.value.data.trips,
      }));
      if (profileResult.status === "fulfilled" && profileResult.value) {
        setPreferences({
          locale: profileResult.value.data.locale,
          timezone: profileResult.value.data.timezone,
        });
      }
      setLoadingMore(false);
      setState("ready");
    },
    [api],
  );

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    void loadTrips();
  }, [loadTrips]);

  useEffect(() => {
    const updateConnection = () => setOffline(!navigator.onLine);
    updateConnection();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  useEffect(() => {
    if (!selectedTrip) previewReturnFocus.current?.focus();
  }, [selectedTrip]);

  const today = new Date().toISOString().slice(0, 10);
  const groups = useMemo(() => {
    const result = new Map<Lifecycle, Trip[]>();
    for (const lifecycle of lifecycleOrder) {
      result.set(lifecycle, []);
    }
    for (const trip of data?.trips ?? []) {
      result.get(lifecycleFor(trip, today))?.push(trip);
    }
    return result;
  }, [data?.trips, today]);

  const visibleGroups = lifecycleOrder.filter(
    (lifecycle) => filter === "all" || filter === lifecycle,
  );
  const visibleTrips = visibleGroups.flatMap((lifecycle) => groups.get(lifecycle) ?? []);

  function openPreview(trip: Trip) {
    if (document.activeElement instanceof HTMLElement) {
      previewReturnFocus.current = document.activeElement;
    }
    setSelectedTrip(trip);
  }

  function closePreview() {
    setDeleteError("");
    setSelectedTrip(null);
  }

  function selectFilterFromKeyboard(index: number, event: React.KeyboardEvent<HTMLButtonElement>) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % lifecycleFilters.length;
    if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + lifecycleFilters.length) % lifecycleFilters.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = lifecycleFilters.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextFilter = lifecycleFilters[nextIndex];
    if (!nextFilter) return;
    setFilter(nextFilter);
    document.querySelector<HTMLButtonElement>(`[data-trip-filter="${nextFilter}"]`)?.focus();
  }

  async function deleteTrip(trip: Trip) {
    setDeleting(true);
    setDeleteError("");
    try {
      await api.deleteTrip(trip.id, { expectedRevision: trip.revision });
      setData((current) =>
        current ? { ...current, trips: current.trips.filter(({ id }) => id !== trip.id) } : current,
      );
      closePreview();
      setMessage(`${trip.title} was removed from your saved trips.`);
    } catch (error) {
      setDeleteError(errorMessage(error));
    } finally {
      setDeleting(false);
    }
  }

  if (state === "loading" && !data) {
    return (
      <ExperienceState
        detail="Finding the trips you have saved and where each one stands."
        headingLevel={1}
        state="loading"
        title="Loading your trips"
      />
    );
  }
  if (state === "error" && !data) {
    return (
      <ExperienceState
        action={
          <Button onClick={() => void loadTrips()} tone="quiet">
            Try again
          </Button>
        }
        detail={message}
        headingLevel={1}
        state="error"
        title="Your trips are not available right now"
      />
    );
  }
  if (!data) {
    return null;
  }
  if (offline && data.trips.length === 0) {
    return (
      <ExperienceState
        detail="Reconnect to load your saved trips. Downloaded trip packages remain available from their offline area."
        headingLevel={1}
        state="offline"
        title="You are offline"
      />
    );
  }

  return (
    <section aria-labelledby="trips-dashboard-heading" className="trips-dashboard">
      <div className="trips-dashboard__intro">
        <p className="eyebrow">Your journeys</p>
        <h1 id="trips-dashboard-heading">Plans you can pick back up.</h1>
        <p>
          Keep drafts, upcoming journeys, and shared plans close—without losing the context behind
          each one.
        </p>
        {email ? (
          <p className="trips-dashboard__identity">
            Signed in as {email} · Dates shown in your {preferences.timezone} setting.
          </p>
        ) : null}
      </div>

      <div className="trips-dashboard__actions">
        <Link className="roavia-button roavia-button--accent" href="/plan">
          Plan a trip
        </Link>
        <Link className="roavia-button roavia-button--quiet" href="/offline">
          Offline downloads
        </Link>
        <Button disabled={state === "loading"} onClick={() => void loadTrips()} tone="quiet">
          Refresh list
        </Button>
      </div>

      {offline ? (
        <output className="trips-dashboard__notice">
          You are offline. This view will refresh when you reconnect.
        </output>
      ) : null}
      {message ? <output className="trips-dashboard__message">{message}</output> : null}

      <div aria-label="Trip lifecycle filters" className="trips-dashboard__filters" role="tablist">
        {lifecycleFilters.map((option, index) => {
          const count = option === "all" ? data.trips.length : (groups.get(option)?.length ?? 0);
          const label = option === "all" ? "All trips" : lifecycleLabels[option];
          return (
            <button
              aria-selected={filter === option}
              className={filter === option ? "is-selected" : undefined}
              data-trip-filter={option}
              key={option}
              onClick={() => setFilter(option)}
              onKeyDown={(event) => selectFilterFromKeyboard(index, event)}
              role="tab"
              tabIndex={filter === option ? 0 : -1}
              type="button"
            >
              {label} <span>{count}</span>
            </button>
          );
        })}
      </div>

      {visibleTrips.length === 0 ? (
        <ExperienceState
          action={
            <Link className="roavia-button roavia-button--accent" href="/plan">
              Plan your first trip
            </Link>
          }
          detail={
            filter === "all"
              ? "Start a guided plan when you are ready. Your saved trips will stay grouped here by their lifecycle."
              : `There are no ${filter === "draft" ? "drafts" : lifecycleLabels[filter].toLowerCase()} right now.`
          }
          state="empty"
          title={filter === "all" ? "No saved trips yet" : "Nothing in this view"}
        />
      ) : (
        <div className="trips-dashboard__groups">
          {visibleGroups.map((lifecycle) => {
            const trips = groups.get(lifecycle) ?? [];
            if (trips.length === 0) return null;
            return (
              <section
                aria-labelledby={`trip-group-${lifecycle}`}
                className="trip-group"
                key={lifecycle}
              >
                <div className="trip-group__heading">
                  <h2 id={`trip-group-${lifecycle}`}>{lifecycleLabels[lifecycle]}</h2>
                  <span>{trips.length}</span>
                </div>
                <div className="trip-group__list">
                  {trips.map((trip) => (
                    <TripCard
                      key={trip.id}
                      locale={preferences.locale}
                      onOpen={openPreview}
                      trip={trip}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {data.pagination.nextCursor ? (
        <Button
          className="trips-dashboard__more"
          disabled={loadingMore || offline}
          onClick={() => void loadTrips(data.pagination.nextCursor ?? undefined)}
          tone="quiet"
        >
          {loadingMore ? "Loading more…" : "Load more trips"}
        </Button>
      ) : null}
      <TrustNotice>
        Your trip list is private by default. Shared links remain separate, explicit choices.
      </TrustNotice>
      {selectedTrip ? (
        <TripPreview
          deleting={deleting}
          error={deleteError}
          locale={preferences.locale}
          onClose={closePreview}
          onDelete={deleteTrip}
          trip={selectedTrip}
        />
      ) : null}
    </section>
  );
}
