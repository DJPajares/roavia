"use client";

import { ApiClientError, createRoaviaApiClient } from "@roavia/api-client";
import type {
  DestinationSearchResult,
  Profile,
  TripCreateInput,
  TripDetail,
  TripUpdateInput,
} from "@roavia/contracts";
import { Button, ExperienceState, TrustNotice } from "@roavia/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { createClient } from "../lib/supabase/client";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

type Step = "details" | "review";
type PlannerState = "loading" | "ready" | "reviewing" | "saving" | "unavailable";
type SearchState = "empty" | "error" | "idle" | "loading" | "offline" | "ready";

interface FormValues {
  adults: number;
  budgetAmount: string;
  budgetStyle: TripCreateInput["budget"]["style"];
  currency: string;
  endDate: string;
  startDate: string;
  title: string;
}

interface SelectedDestination {
  persistedId?: string;
  place: DestinationSearchResult;
  timezone?: string | null;
}

const initialValues: FormValues = {
  adults: 1,
  budgetAmount: "",
  budgetStyle: "midrange",
  currency: "USD",
  endDate: "",
  startDate: "",
  title: "",
};

function errorMessage(error: unknown) {
  if (error instanceof ApiClientError && error.status === 401) {
    return "Your session has expired. Sign in again before saving this trip.";
  }
  if (error instanceof ApiClientError && error.status === 409) {
    return "This trip changed in another session. Reload it before trying again; your choices remain on this page.";
  }
  return error instanceof Error
    ? error.message
    : "We could not save your trip. Your details are still here.";
}

function toInput(values: FormValues): TripCreateInput {
  return {
    budget: {
      amountMinor: values.budgetAmount ? Math.round(Number(values.budgetAmount) * 100) : null,
      currency: values.currency.toUpperCase(),
      style: values.budgetStyle,
    },
    dateFlexibility: { daysAfter: 0, daysBefore: 0 },
    endDate: values.endDate,
    originPlaceId: null,
    planningPreferences: null,
    startDate: values.startDate,
    status: "draft",
    title: values.title.trim(),
    travelerSummary: { adults: values.adults, children: 0, infants: 0 },
    visibility: "private",
  };
}

function validate(values: FormValues, destinations: SelectedDestination[]) {
  if (!values.title.trim()) return "Add a trip name.";
  if (!values.startDate || !values.endDate) return "Add both trip dates.";
  if (values.endDate < values.startDate) return "The end date must be on or after the start date.";
  if (!Number.isInteger(values.adults) || values.adults < 1) return "Add at least one adult.";
  if (!/^[A-Z]{3}$/.test(values.currency)) return "Use a three-letter currency code.";
  if (values.budgetAmount && Number(values.budgetAmount) < 0) {
    return "Budget amount cannot be negative.";
  }
  if (destinations.length === 0) return "Choose at least one destination.";
  return null;
}

function hierarchyLabel(place: DestinationSearchResult) {
  return [...place.hierarchy.map((item) => item.name), place.countryCode]
    .filter(Boolean)
    .join(" / ");
}

function itineraryDates(startDate: string, endDate: string) {
  const dates: string[] = [];
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  for (let timestamp = start; timestamp <= end; timestamp += 86_400_000) {
    dates.push(new Date(timestamp).toISOString().slice(0, 10));
  }
  return dates;
}

function destinationFromDetail(
  detail: Awaited<ReturnType<ReturnType<typeof createRoaviaApiClient>["getDestination"]>>["data"],
): DestinationSearchResult {
  return {
    canonicalName: detail.place.canonicalName,
    countryCode: detail.place.countryCode,
    hierarchy: detail.place.hierarchy,
    id: detail.place.id,
    localizedNames: detail.place.localizedNames,
    placeType: detail.place.placeType,
  };
}

export function GuidedTripPlanner({ resumeTripId }: Readonly<{ resumeTripId?: string }>) {
  const router = useRouter();
  const [preferences, setPreferences] = useState<Profile | null>(null);
  const [values, setValues] = useState<FormValues>(initialValues);
  const [state, setState] = useState<PlannerState>("loading");
  const [step, setStep] = useState<Step>("details");
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState<number | null>(null);
  const [savedTripId, setSavedTripId] = useState<string | null>(resumeTripId ?? null);
  const [selectedDestinations, setSelectedDestinations] = useState<SelectedDestination[]>([]);
  const [persistedDestinations, setPersistedDestinations] = useState<TripDetail["destinations"]>(
    [],
  );
  const [persistedDayDates, setPersistedDayDates] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DestinationSearchResult[]>([]);
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const api = useMemo(
    () =>
      createRoaviaApiClient({
        accessToken: async () =>
          (await createClient().auth.getSession()).data.session?.access_token ?? null,
        baseUrl: apiBaseUrl,
      }),
    [],
  );

  const load = useCallback(async () => {
    setState("loading");
    setMessage("");
    const [profileResult, tripResult] = await Promise.allSettled([
      api.getProfile(),
      resumeTripId ? api.getTrip(resumeTripId) : Promise.resolve(null),
    ]);
    if (profileResult.status === "rejected") {
      setState("unavailable");
      setMessage("We could not load your saved planning preferences. Try again to continue.");
      return;
    }
    if (tripResult.status === "rejected") {
      setState("unavailable");
      setMessage("We could not restore this saved trip. Try again from your Trips page.");
      return;
    }

    setPreferences(profileResult.value.data);
    const trip = tripResult.value;
    if (trip) {
      setValues({
        adults: trip.data.travelerSummary.adults,
        budgetAmount:
          trip.data.budget.amountMinor === null ? "" : String(trip.data.budget.amountMinor / 100),
        budgetStyle: trip.data.budget.style,
        currency: trip.data.budget.currency,
        endDate: trip.data.endDate,
        startDate: trip.data.startDate,
        title: trip.data.title,
      });
      setRevision(trip.data.revision);
      setSavedTripId(trip.data.id);
      const savedDestinations = trip.data.destinations.toSorted(
        (left, right) => left.orderIndex - right.orderIndex,
      );
      setPersistedDestinations(savedDestinations);
      setPersistedDayDates(trip.data.days.map((day) => day.localDate));
      const details = await Promise.allSettled(
        savedDestinations.map((destination) => api.getDestination(destination.placeId)),
      );
      setSelectedDestinations(
        details.map((result, index) => {
          const destination = savedDestinations[index]!;
          return result.status === "fulfilled"
            ? {
                persistedId: destination.id,
                place: destinationFromDetail(result.value.data),
                timezone: result.value.data.place.timezone,
              }
            : {
                persistedId: destination.id,
                place: {
                  canonicalName: "Saved destination",
                  countryCode: null,
                  hierarchy: [],
                  id: destination.placeId,
                  localizedNames: {},
                  placeType: "city",
                },
                timezone: null,
              };
        }),
      );
      setMessage(
        details.some((result) => result.status === "rejected")
          ? "Your saved trip was restored, but some destination details are unavailable. Search again before creating itinerary days."
          : "Your saved draft has been restored. Review and update anything you need.",
      );
    } else {
      const profile = profileResult.value.data;
      setValues((current) => ({
        ...current,
        budgetStyle: profile.defaultBudgetStyle,
        currency: profile.preferredCurrency,
      }));
    }
    setState("ready");
  }, [api, resumeTripId]);

  useEffect(() => {
    void load();
  }, [load]);

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function searchDestinations() {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setSearchState("idle");
      setResults([]);
      setMessage("Enter a city, region, country, or place to search the destination catalogue.");
      return;
    }
    if (!navigator.onLine) {
      setSearchState("offline");
      return;
    }
    setSearchState("loading");
    setMessage("");
    try {
      const response = await api.searchDestinations({
        limit: 8,
        page: 1,
        query: trimmedQuery,
        types: ["country", "region", "city", "district", "poi"],
      });
      setResults(response.data.results);
      setSearchState(response.data.results.length > 0 ? "ready" : "empty");
    } catch {
      setSearchState("error");
    }
  }

  function addDestination(place: DestinationSearchResult) {
    if (selectedDestinations.some((destination) => destination.place.id === place.id)) {
      setMessage(`${place.canonicalName} is already part of this trip.`);
      return;
    }
    if (selectedDestinations.length >= 10) {
      setMessage("A trip can include up to 10 destinations in this planning flow.");
      return;
    }
    setSelectedDestinations((current) => [...current, { place }]);
    setMessage(`${place.canonicalName} added. You can reorder or remove it before saving.`);
  }

  function moveDestination(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= selectedDestinations.length) return;
    setSelectedDestinations((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function removeDestination(index: number) {
    const removed = selectedDestinations[index];
    setSelectedDestinations((current) =>
      current.filter((_, currentIndex) => currentIndex !== index),
    );
    setMessage(`${removed?.place.canonicalName ?? "Destination"} removed from this draft.`);
  }

  async function review(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validate(values, selectedDestinations);
    if (validation) {
      setMessage(validation);
      return;
    }
    setState("reviewing");
    setMessage("");
    const details = await Promise.allSettled(
      selectedDestinations.map((destination) => api.getDestination(destination.place.id)),
    );
    const unavailable = details.findIndex(
      (result) => result.status === "rejected" || !result.value.data.place.timezone,
    );
    if (unavailable >= 0) {
      setState("ready");
      setMessage(
        `We could not confirm a local time zone for ${selectedDestinations[unavailable]?.place.canonicalName ?? "that destination"}. Your choices are unchanged; try the catalogue again.`,
      );
      return;
    }
    setSelectedDestinations((current) =>
      current.map((destination, index) => {
        const detail = details[index];
        return detail?.status === "fulfilled"
          ? {
              ...destination,
              place: destinationFromDetail(detail.value.data),
              timezone: detail.value.data.place.timezone,
            }
          : destination;
      }),
    );
    setStep("review");
    setState("ready");
  }

  async function syncDestinations(
    tripId: string,
    startingRevision: number,
    destinations: SelectedDestination[],
  ) {
    let currentRevision = startingRevision;
    let current = persistedDestinations.toSorted(
      (left, right) => left.orderIndex - right.orderIndex,
    );
    const selectedIds = new Set(destinations.map((destination) => destination.persistedId));

    for (const destination of current.toReversed()) {
      if (selectedIds.has(destination.id)) continue;
      const deleted = await api.deleteTripDestination(tripId, destination.id, {
        expectedTripRevision: currentRevision,
      });
      currentRevision = deleted.data.tripRevision;
      current = current
        .filter((item) => item.id !== destination.id)
        .map((item, index) => ({ ...item, orderIndex: index }));
      setRevision(currentRevision);
      setPersistedDestinations(current);
    }

    for (const [index, selection] of destinations.entries()) {
      if (selection.persistedId) {
        const currentIndex = current.findIndex((item) => item.id === selection.persistedId);
        if (currentIndex === index) continue;
        const updated = await api.updateTripDestination(tripId, selection.persistedId, {
          expectedTripRevision: currentRevision,
          orderIndex: index,
        });
        currentRevision = updated.data.tripRevision;
        const [moved] = current.splice(currentIndex, 1);
        current.splice(index, 0, { ...moved!, orderIndex: index });
        current = current.map((item, orderIndex) => ({ ...item, orderIndex }));
      } else {
        const created = await api.createTripDestination(tripId, {
          arrivalAt: null,
          departureAt: null,
          expectedTripRevision: currentRevision,
          orderIndex: index,
          placeId: selection.place.id,
        });
        currentRevision = created.data.tripRevision;
        current.splice(index, 0, created.data.destination);
        current = current.map((item, orderIndex) => ({ ...item, orderIndex }));
        destinations[index] = { ...selection, persistedId: created.data.destination.id };
        setSelectedDestinations([...destinations]);
      }
      setRevision(currentRevision);
      setPersistedDestinations([...current]);
    }
    return currentRevision;
  }

  async function persist(openWorkspace: boolean) {
    const validation = validate(values, selectedDestinations);
    if (validation) {
      setMessage(validation);
      return;
    }
    if (selectedDestinations.some((destination) => !destination.timezone)) {
      setMessage("Review the trip again so Roavia can confirm the destination time zone.");
      setStep("details");
      return;
    }

    setState("saving");
    setMessage("");
    try {
      const input = toInput(values);
      const trip =
        savedTripId && revision !== null
          ? await api.updateTrip(savedTripId, {
              ...input,
              expectedRevision: revision,
            } satisfies TripUpdateInput)
          : await api.createTrip(input);
      const tripId = trip.data.id;
      setSavedTripId(tripId);
      setRevision(trip.data.revision);
      setPersistedDestinations(trip.data.destinations);
      setPersistedDayDates(trip.data.days.map((day) => day.localDate));

      const mutableSelections = [...selectedDestinations];
      let currentRevision = await syncDestinations(tripId, trip.data.revision, mutableSelections);

      if (!openWorkspace) {
        router.replace(`/plan?tripId=${tripId}`);
        setMessage(`${trip.data.title} and its destinations are saved. You can resume from Trips.`);
        return;
      }

      const timezone = mutableSelections[0]!.timezone!;
      const existingDates = new Set(persistedDayDates);
      for (const [index, localDate] of itineraryDates(values.startDate, values.endDate).entries()) {
        if (existingDates.has(localDate)) continue;
        const created = await api.createTripDay(tripId, {
          expectedTripRevision: currentRevision,
          localDate,
          notes: null,
          orderIndex: index,
          timezone,
          title: null,
        });
        currentRevision = created.data.tripRevision;
        existingDates.add(localDate);
        setRevision(currentRevision);
        setPersistedDayDates([...existingDates]);
      }
      router.push(`/trips/${tripId}`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setState("ready");
    }
  }

  if (state === "loading") {
    return (
      <ExperienceState
        detail="Loading the preferences and saved destinations you can choose to apply."
        headingLevel={1}
        state="loading"
        title="Starting your manual plan"
      />
    );
  }
  if (state === "unavailable") {
    return (
      <ExperienceState
        action={
          <Button onClick={() => void load()} tone="quiet">
            Try again
          </Button>
        }
        detail={message}
        headingLevel={1}
        state="error"
        title="Manual planning is unavailable"
      />
    );
  }

  const applied = preferences
    ? [
        `${preferences.defaultPace} pace`,
        ...preferences.interests.map((interest) => `${interest} interest`),
        ...preferences.accessibilityNeeds,
        ...preferences.dietaryNeeds,
        ...preferences.travelPreferences.mustDo.map((item) => `Do: ${item}`),
        ...preferences.travelPreferences.mustAvoid.map((item) => `Avoid: ${item}`),
      ]
    : [];

  return (
    <section aria-labelledby="guided-trip-heading" className="profile-preferences manual-planner">
      <div className="profile-preferences__intro">
        <p className="eyebrow">Manual planning</p>
        <h1 id="guided-trip-heading">Choose the places. Shape every day.</h1>
        <p>
          Build a blank trip from destinations you select. This path saves directly to your
          itinerary and does not use AI.
        </p>
      </div>

      {step === "details" ? (
        <form className="profile-preferences__form" onSubmit={(event) => void review(event)}>
          <fieldset>
            <legend>Your trip</legend>
            <label>
              Trip name
              <input
                name="title"
                onChange={(event) => update("title", event.target.value)}
                required
                value={values.title}
              />
            </label>
            <label>
              Start date
              <input
                name="startDate"
                onChange={(event) => update("startDate", event.target.value)}
                required
                type="date"
                value={values.startDate}
              />
            </label>
            <label>
              End date
              <input
                min={values.startDate || undefined}
                name="endDate"
                onChange={(event) => update("endDate", event.target.value)}
                required
                type="date"
                value={values.endDate}
              />
            </label>
            <label>
              Adults
              <input
                min="1"
                name="adults"
                onChange={(event) => update("adults", Number(event.target.value))}
                required
                type="number"
                value={values.adults}
              />
            </label>
          </fieldset>

          <fieldset className="manual-destination-picker">
            <legend>Destinations</legend>
            <p>
              Search the approved catalogue, then arrange places in the order you plan to visit.
            </p>
            <label htmlFor="manual-destination-query">
              Search destinations
              <input
                autoComplete="off"
                id="manual-destination-query"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void searchDestinations();
                  }
                }}
                placeholder="City, region, country, or place"
                type="search"
                value={query}
              />
            </label>
            <div className="manual-destination-picker__search-actions">
              <Button
                disabled={searchState === "loading"}
                onClick={() => void searchDestinations()}
                tone="quiet"
                type="button"
              >
                {searchState === "loading" ? "Searching…" : "Search catalogue"}
              </Button>
            </div>

            {searchState === "offline" ? (
              <ExperienceState
                detail="Reconnect to search. Your trip details and selected destinations are unchanged."
                state="offline"
                title="Destination search needs a connection"
              />
            ) : null}
            {searchState === "error" ? (
              <ExperienceState
                action={
                  <Button onClick={() => void searchDestinations()} tone="quiet">
                    Try again
                  </Button>
                }
                detail="The destination catalogue is unavailable. Your trip details and search text are unchanged."
                state="error"
                title="We could not search destinations"
              />
            ) : null}
            {searchState === "empty" ? (
              <ExperienceState
                detail="Try another spelling or a nearby city or region. Your search text stays available for correction."
                state="empty"
                title="No usable destination matched"
              />
            ) : null}
            {searchState === "ready" ? (
              <ul
                aria-label="Destination search results"
                className="manual-destination-picker__results"
              >
                {results.map((place) => {
                  const selected = selectedDestinations.some(
                    (destination) => destination.place.id === place.id,
                  );
                  return (
                    <li key={place.id}>
                      <div>
                        <strong>{place.canonicalName}</strong>
                        <span>{hierarchyLabel(place) || place.placeType.replace("_", " ")}</span>
                      </div>
                      <Button
                        disabled={selected}
                        onClick={() => addDestination(place)}
                        tone="quiet"
                        type="button"
                      >
                        {selected ? "Added" : `Add ${place.canonicalName}`}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            <div aria-live="polite" className="manual-destination-picker__selected">
              <h2>Your route</h2>
              {selectedDestinations.length > 0 ? (
                <ol>
                  {selectedDestinations.map((destination, index) => (
                    <li key={destination.place.id}>
                      <div>
                        <span>{index + 1}</span>
                        <p>
                          <strong>{destination.place.canonicalName}</strong>
                          <small>
                            {hierarchyLabel(destination.place) ||
                              destination.place.placeType.replace("_", " ")}
                          </small>
                        </p>
                      </div>
                      <div className="manual-destination-picker__route-actions">
                        <button
                          aria-label={`Move ${destination.place.canonicalName} earlier`}
                          disabled={index === 0}
                          onClick={() => moveDestination(index, -1)}
                          type="button"
                        >
                          ↑
                        </button>
                        <button
                          aria-label={`Move ${destination.place.canonicalName} later`}
                          disabled={index === selectedDestinations.length - 1}
                          onClick={() => moveDestination(index, 1)}
                          type="button"
                        >
                          ↓
                        </button>
                        <button
                          aria-label={`Remove ${destination.place.canonicalName}`}
                          onClick={() => removeDestination(index)}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>No destinations selected yet.</p>
              )}
            </div>
          </fieldset>

          <fieldset>
            <legend>Budget</legend>
            <label>
              Budget style
              <select
                name="budgetStyle"
                onChange={(event) =>
                  update("budgetStyle", event.target.value as FormValues["budgetStyle"])
                }
                value={values.budgetStyle}
              >
                {["budget", "midrange", "premium", "luxury"].map((style) => (
                  <option key={style}>{style}</option>
                ))}
              </select>
            </label>
            <label>
              Budget amount (optional)
              <input
                inputMode="decimal"
                min="0"
                name="budgetAmount"
                onChange={(event) => update("budgetAmount", event.target.value)}
                type="number"
                value={values.budgetAmount}
              />
            </label>
            <label>
              Currency
              <input
                maxLength={3}
                name="currency"
                onChange={(event) => update("currency", event.target.value.toUpperCase())}
                value={values.currency}
              />
            </label>
          </fieldset>
          {applied.length ? (
            <fieldset>
              <legend>Saved preferences — visible, not automatic</legend>
              <p>{applied.join(" · ")}</p>
              <p>These profile preferences do not generate or change this itinerary.</p>
            </fieldset>
          ) : null}
          <div className="profile-preferences__actions">
            <Button disabled={state === "reviewing"} type="submit">
              {state === "reviewing" ? "Checking destinations…" : "Review manual trip"}
            </Button>
          </div>
          <output aria-live="polite">{message}</output>
        </form>
      ) : (
        <section className="profile-preferences__form" aria-labelledby="trip-review-heading">
          <p className="eyebrow">Review before saving</p>
          <h2 id="trip-review-heading">A blank itinerary, ready for your plans.</h2>
          <dl>
            <div>
              <dt>Trip</dt>
              <dd>{values.title}</dd>
            </div>
            <div>
              <dt>Dates</dt>
              <dd>
                {values.startDate} to {values.endDate}
              </dd>
            </div>
            <div>
              <dt>Travelers</dt>
              <dd>
                {values.adults} adult{values.adults === 1 ? "" : "s"}
              </dd>
            </div>
            <div>
              <dt>Budget</dt>
              <dd>
                {values.budgetStyle}
                {values.budgetAmount ? ` · ${values.currency} ${values.budgetAmount}` : ""}
              </dd>
            </div>
            <div>
              <dt>Destinations</dt>
              <dd>{selectedDestinations.map(({ place }) => place.canonicalName).join(" → ")}</dd>
            </div>
            <div>
              <dt>Initial day time zone</dt>
              <dd>
                {selectedDestinations[0]?.place.canonicalName} · {selectedDestinations[0]?.timezone}
              </dd>
            </div>
          </dl>
          <p>
            Roavia will create one empty itinerary day for each date. No activities, routes, or
            recommendations will be added automatically.
          </p>
          <div className="profile-preferences__actions">
            <Button disabled={state === "saving"} onClick={() => void persist(true)}>
              {state === "saving" ? "Creating…" : "Create blank trip"}
            </Button>
            <Button disabled={state === "saving"} onClick={() => void persist(false)} tone="quiet">
              Save for later
            </Button>
            <Button disabled={state === "saving"} onClick={() => setStep("details")} tone="quiet">
              Edit details
            </Button>
            <Link className="roavia-button roavia-button--quiet" href="/trips">
              View trips
            </Link>
          </div>
          <output aria-live="polite">{message}</output>
        </section>
      )}
      <TrustNotice label="Manual planning boundary">
        This flow uses the destination catalogue and your private trip APIs only. It does not send a
        prompt, start generation, or call an AI provider.
      </TrustNotice>
    </section>
  );
}
