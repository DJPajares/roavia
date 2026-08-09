"use client";

import { ApiClientError, createRoaviaApiClient } from "@roavia/api-client";
import type {
  ItineraryGenerationSummary,
  TripCreateInput,
  TripIntentDestination,
  TripIntentExtraction,
} from "@roavia/contracts";
import { Button, TrustNotice } from "@roavia/ui";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { createClient } from "../lib/supabase/client";
import { GuidedTripPlanner } from "./guided-trip-planner";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";
const generationStages = [
  ["queued", "Preparing your request"],
  ["retrieving", "Gathering current destination context"],
  ["generating", "Building a day-by-day draft"],
  ["validating", "Checking timing, evidence, and constraints"],
  ["repairing", "Resolving issues in the draft"],
  ["persisting", "Saving the itinerary to your workspace"],
] as const;

type PlannerMode = "natural" | "guided";
type PlannerPhase =
  "prompt" | "extracting" | "review" | "saving" | "generating" | "failed" | "cancelled";

interface ReviewValues {
  accessibility: string;
  adults: number;
  budgetAmount: string;
  budgetStyle: "budget" | "midrange" | "premium" | "luxury";
  children: number;
  currency: string;
  daysAfter: number;
  daysBefore: number;
  dietary: string;
  endDate: string;
  infants: number;
  interests: string;
  mustAvoid: string;
  mustDo: string;
  pace: "slow" | "balanced" | "fast";
  startDate: string;
  title: string;
}

interface GenerationReference {
  generationRunId: string;
  jobId: string;
}

function list(value: string) {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function errorMessage(error: unknown) {
  if (error instanceof ApiClientError && error.status === 401) {
    return "Your session expired. Sign in again, then retry without losing your request.";
  }
  if (error instanceof ApiClientError && error.code === "planner_service_unavailable") {
    return "Natural-language planning is not configured on this API yet. Your request is still here.";
  }
  return error instanceof Error
    ? error.message
    : "Something interrupted planning. Your work is still here.";
}

function reviewValues(extraction: TripIntentExtraction): ReviewValues {
  const { intent } = extraction;
  return {
    accessibility: intent.constraints.accessibility.join(", "),
    adults: intent.travelers?.adults ?? 1,
    budgetAmount:
      intent.budget?.amountMinor === null || intent.budget?.amountMinor === undefined
        ? ""
        : String(intent.budget.amountMinor / 100),
    budgetStyle: intent.budget?.style ?? "midrange",
    children: intent.travelers?.children ?? 0,
    currency: intent.budget?.currency ?? "USD",
    daysAfter: intent.dateFlexibility.daysAfter,
    daysBefore: intent.dateFlexibility.daysBefore,
    dietary: intent.constraints.dietary.join(", "),
    endDate: intent.endDate ?? "",
    infants: intent.travelers?.infants ?? 0,
    interests: intent.interests.join(", "),
    mustAvoid: intent.constraints.mustAvoid.join(", "),
    mustDo: intent.constraints.mustDo.join(", "),
    pace: intent.pace ?? "balanced",
    startDate: intent.startDate ?? "",
    title: intent.title ?? "",
  };
}

function validateReview(values: ReviewValues, destinations: TripIntentDestination[]) {
  if (!values.title.trim()) return "Add a trip name.";
  if (!values.startDate || !values.endDate) return "Add both trip dates.";
  if (values.endDate < values.startDate) return "The end date must be on or after the start date.";
  if (values.adults + values.children + values.infants < 1) return "Add at least one traveler.";
  if (!/^[A-Z]{3}$/.test(values.currency)) return "Use a three-letter currency code.";
  if (destinations.length === 0) return "Add a destination in your request.";
  if (destinations.some((destination) => !destination.selectedPlaceId)) {
    return "Choose a match for every destination.";
  }
  const selectedPlaceIds = destinations.map((destination) => destination.selectedPlaceId);
  if (new Set(selectedPlaceIds).size !== selectedPlaceIds.length) {
    return "Each destination must use a different place.";
  }
  return null;
}

export function TripPlanner({
  initialMode = "natural",
  resumeTripId,
}: Readonly<{ initialMode?: PlannerMode; resumeTripId?: string }>) {
  const [mode, setMode] = useState<PlannerMode>(initialMode);

  return (
    <div className="trip-planner-shell">
      <nav aria-label="Trip planning method" className="trip-planner-shell__modes">
        <button aria-pressed={mode === "natural"} onClick={() => setMode("natural")} type="button">
          Describe your trip
        </button>
        <button aria-pressed={mode === "guided"} onClick={() => setMode("guided")} type="button">
          Guided form
        </button>
      </nav>
      {mode === "natural" ? (
        <NaturalLanguageTripPlanner />
      ) : (
        <GuidedTripPlanner resumeTripId={resumeTripId} />
      )}
    </div>
  );
}

export function NaturalLanguageTripPlanner() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [phase, setPhase] = useState<PlannerPhase>("prompt");
  const [extraction, setExtraction] = useState<TripIntentExtraction | null>(null);
  const [values, setValues] = useState<ReviewValues | null>(null);
  const [destinations, setDestinations] = useState<TripIntentDestination[]>([]);
  const [message, setMessage] = useState("");
  const [online, setOnline] = useState(true);
  const [tripId, setTripId] = useState<string | null>(null);
  const [revision, setRevision] = useState<number | null>(null);
  const [generation, setGeneration] = useState<GenerationReference | null>(null);
  const [generationStatus, setGenerationStatus] = useState<ItineraryGenerationSummary | null>(null);
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
    const updateConnection = () => setOnline(navigator.onLine);
    updateConnection();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  useEffect(() => {
    if (phase !== "generating" || !tripId) return;
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await api.getTripGeneration(tripId);
        if (!active || !response.data) return;
        setGenerationStatus(response.data);
        if (response.data.status === "succeeded") {
          router.push(`/trips/${tripId}`);
          return;
        }
        if (response.data.status === "failed" || response.data.status === "cancelled") {
          setPhase(response.data.status === "cancelled" ? "cancelled" : "failed");
          setMessage(
            response.data.status === "cancelled"
              ? "Generation was cancelled. Your reviewed trip is still saved."
              : "Generation stopped before a complete itinerary was ready. You can retry or open the saved draft.",
          );
          return;
        }
        timeout = setTimeout(poll, 1_250);
      } catch (error) {
        if (!active) return;
        setPhase("failed");
        setMessage(errorMessage(error));
      }
    };
    void poll();
    return () => {
      active = false;
      if (timeout) clearTimeout(timeout);
    };
  }, [api, phase, router, tripId]);

  function update<K extends keyof ReviewValues>(key: K, value: ReviewValues[K]) {
    setValues((current) => (current ? { ...current, [key]: value } : current));
  }

  async function extract(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!online) {
      setMessage("Reconnect before interpreting this request. The text will stay here.");
      return;
    }
    setPhase("extracting");
    setMessage("");
    try {
      const response = await api.extractTripIntent({
        locale: navigator.language || "en",
        prompt,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      });
      setExtraction(response.data);
      setValues(reviewValues(response.data));
      setDestinations(response.data.intent.destinations);
      setPhase("review");
    } catch (error) {
      setPhase("prompt");
      setMessage(errorMessage(error));
    }
  }

  async function beginGeneration() {
    if (!values) return;
    const validation = validateReview(values, destinations);
    if (validation) {
      setMessage(validation);
      return;
    }
    if (!online) {
      setMessage("Reconnect before generating. Your reviewed details will stay here.");
      return;
    }
    setPhase("saving");
    setMessage("");
    try {
      const tripInput: TripCreateInput = {
        budget: {
          amountMinor: values.budgetAmount ? Math.round(Number(values.budgetAmount) * 100) : null,
          currency: values.currency,
          style: values.budgetStyle,
        },
        dateFlexibility: { daysAfter: values.daysAfter, daysBefore: values.daysBefore },
        endDate: values.endDate,
        originPlaceId: null,
        planningPreferences: {
          accessibilityNeeds: list(values.accessibility),
          dietaryNeeds: list(values.dietary),
          interests: list(values.interests),
          mustAvoid: list(values.mustAvoid),
          mustDo: list(values.mustDo),
          pace: values.pace,
        },
        startDate: values.startDate,
        status: "draft",
        title: values.title.trim(),
        travelerSummary: {
          adults: values.adults,
          children: values.children,
          infants: values.infants,
        },
        visibility: "private",
      };
      const created = await api.createTrip(tripInput);
      let currentRevision = created.data.revision;
      setRevision(currentRevision);
      setTripId(created.data.id);
      for (const [index, destination] of destinations.entries()) {
        const added = await api.createTripDestination(created.data.id, {
          arrivalAt: null,
          departureAt: null,
          expectedTripRevision: currentRevision,
          orderIndex: index,
          placeId: destination.selectedPlaceId!,
        });
        currentRevision = added.data.tripRevision;
        setRevision(currentRevision);
      }
      const queued = await api.generateTrip(created.data.id, {
        expectedTripRevision: currentRevision,
      });
      setRevision(queued.data.tripRevision);
      setGeneration({
        generationRunId: queued.data.generationRunId,
        jobId: queued.data.jobId,
      });
      setGenerationStatus(null);
      setPhase("generating");
    } catch (error) {
      setPhase("failed");
      setMessage(errorMessage(error));
    }
  }

  async function retryGeneration() {
    if (!tripId || !revision || !online) {
      setMessage(
        online ? "The saved trip could not be found for retry." : "Reconnect before retrying.",
      );
      return;
    }
    setPhase("saving");
    setMessage("");
    try {
      const queued = await api.regenerateTrip(tripId, { expectedTripRevision: revision });
      setRevision(queued.data.tripRevision);
      setGeneration({ generationRunId: queued.data.generationRunId, jobId: queued.data.jobId });
      setGenerationStatus(null);
      setPhase("generating");
    } catch (error) {
      setPhase("failed");
      setMessage(errorMessage(error));
    }
  }

  async function cancelGeneration() {
    if (!tripId || !generation) return;
    try {
      await api.cancelTripGeneration(tripId, generation);
      setPhase("cancelled");
      setMessage("Generation was cancelled. Your reviewed trip is still saved.");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  if (phase === "generating" || phase === "saving" || phase === "failed" || phase === "cancelled") {
    const currentStatus = generationStatus?.status ?? (phase === "saving" ? "queued" : "queued");
    const stageIndex = generationStages.findIndex(([status]) => status === currentStatus);
    const isPartial = generationStatus?.groundingStatus === "partial";
    return (
      <section aria-labelledby="generation-heading" className="profile-preferences natural-planner">
        <div className="profile-preferences__intro">
          <p className="eyebrow">Itinerary generation</p>
          <h1 id="generation-heading">
            {phase === "failed"
              ? "Your draft is safe."
              : phase === "cancelled"
                ? "Generation paused."
                : "Building your trip."}
          </h1>
          <p aria-live="polite">
            {phase === "failed" || phase === "cancelled"
              ? message
              : phase === "saving"
                ? "Saving the details you reviewed."
                : (generationStages[Math.max(0, stageIndex)]?.[1] ?? message)}
          </p>
        </div>
        <ol className="natural-planner__progress">
          {generationStages.map(([status, label], index) => (
            <li
              aria-current={status === currentStatus ? "step" : undefined}
              className={
                index < stageIndex ? "is-complete" : status === currentStatus ? "is-current" : ""
              }
              key={status}
            >
              {label}
            </li>
          ))}
        </ol>
        {isPartial ? (
          <p className="natural-planner__warning">
            Some destination evidence was collected before generation stopped. The saved trip is
            available, but the itinerary is incomplete.
          </p>
        ) : null}
        {message && phase !== "failed" && phase !== "cancelled" ? (
          <output className="natural-planner__message">{message}</output>
        ) : null}
        <div className="profile-preferences__actions">
          {phase === "generating" && generation ? (
            <Button onClick={() => void cancelGeneration()} tone="quiet">
              Cancel generation
            </Button>
          ) : null}
          {(phase === "failed" || phase === "cancelled") && tripId && revision && generation ? (
            <Button onClick={() => void retryGeneration()}>Retry generation</Button>
          ) : null}
          {tripId ? (
            <Button onClick={() => router.push(`/trips/${tripId}`)} tone="quiet">
              Open saved trip
            </Button>
          ) : null}
          {phase === "failed" && !tripId ? (
            <Button onClick={() => setPhase(extraction ? "review" : "prompt")} tone="quiet">
              Return to planner
            </Button>
          ) : null}
        </div>
      </section>
    );
  }

  if (phase === "prompt" || phase === "extracting") {
    return (
      <section
        aria-labelledby="natural-planner-heading"
        className="profile-preferences natural-planner"
      >
        <div className="profile-preferences__intro">
          <p className="eyebrow">Natural-language planning</p>
          <h1 id="natural-planner-heading">Tell us the trip you have in mind.</h1>
          <p>
            Include destinations, dates, travelers, budget, pace, interests, and any accessibility
            or dietary needs you already know.
          </p>
        </div>
        <form className="profile-preferences__form" onSubmit={extract}>
          <label>
            Trip request
            <textarea
              minLength={20}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="A relaxed week in Kyoto in October for two adults, with a midrange budget, vegetarian food, gardens, and step-free routes."
              required
              rows={7}
              value={prompt}
            />
          </label>
          {!online ? (
            <p className="natural-planner__warning">
              You are offline. Your request will stay here until you reconnect.
            </p>
          ) : null}
          <div className="profile-preferences__actions">
            <Button disabled={phase === "extracting" || !online} type="submit">
              {phase === "extracting" ? "Interpreting…" : "Review trip details"}
            </Button>
          </div>
          <output aria-live="polite">{message}</output>
        </form>
        <TrustNotice>
          Roavia will show every extracted field and assumption before saving or generating
          anything.
        </TrustNotice>
      </section>
    );
  }

  if (!values || !extraction) return null;

  return (
    <section aria-labelledby="review-heading" className="profile-preferences natural-planner">
      <div className="profile-preferences__intro">
        <p className="eyebrow">Review before generation</p>
        <h1 id="review-heading">Correct what Roavia understood.</h1>
        <p>Nothing below is saved until you choose Generate itinerary.</p>
      </div>
      {extraction.assumptions.length > 0 ? (
        <aside className="natural-planner__notice" aria-labelledby="assumptions-heading">
          <h2 id="assumptions-heading">Inferred assumptions</h2>
          <ul>
            {extraction.assumptions.map((item) => (
              <li key={`${item.field}-${item.summary}`}>{item.summary}</li>
            ))}
          </ul>
        </aside>
      ) : null}
      {extraction.issues.length > 0 ? (
        <aside
          className="natural-planner__notice natural-planner__notice--warning"
          aria-labelledby="issues-heading"
        >
          <h2 id="issues-heading">Details to check</h2>
          <ul>
            {extraction.issues.map((item) => (
              <li key={`${item.code}-${item.message}`}>{item.message}</li>
            ))}
          </ul>
        </aside>
      ) : null}
      <form
        className="profile-preferences__form"
        onSubmit={(event) => {
          event.preventDefault();
          void beginGeneration();
        }}
      >
        <fieldset>
          <legend>Trip and destinations</legend>
          <label>
            Trip name
            <input
              onChange={(event) => update("title", event.target.value)}
              required
              value={values.title}
            />
          </label>
          {destinations.map((destination, index) => (
            <label key={`${destination.query}-${index}`}>
              Match for {destination.query}
              <select
                onChange={(event) =>
                  setDestinations((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, selectedPlaceId: event.target.value || null }
                        : item,
                    ),
                  )
                }
                required
                value={destination.selectedPlaceId ?? ""}
              >
                <option value="">Choose a destination</option>
                {destination.candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.canonicalName}
                    {candidate.countryCode ? ` · ${candidate.countryCode}` : ""}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <Button onClick={() => setPhase("prompt")} tone="quiet" type="button">
            Edit the original request
          </Button>
        </fieldset>
        <fieldset>
          <legend>Dates and flexibility</legend>
          <label>
            Start date
            <input
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
              onChange={(event) => update("endDate", event.target.value)}
              required
              type="date"
              value={values.endDate}
            />
          </label>
          <label>
            Flexible days before
            <input
              min="0"
              onChange={(event) => update("daysBefore", Number(event.target.value))}
              type="number"
              value={values.daysBefore}
            />
          </label>
          <label>
            Flexible days after
            <input
              min="0"
              onChange={(event) => update("daysAfter", Number(event.target.value))}
              type="number"
              value={values.daysAfter}
            />
          </label>
        </fieldset>
        <fieldset>
          <legend>Travelers and budget</legend>
          <label>
            Adults
            <input
              min="0"
              onChange={(event) => update("adults", Number(event.target.value))}
              required
              type="number"
              value={values.adults}
            />
          </label>
          <label>
            Children
            <input
              min="0"
              onChange={(event) => update("children", Number(event.target.value))}
              type="number"
              value={values.children}
            />
          </label>
          <label>
            Infants
            <input
              min="0"
              onChange={(event) => update("infants", Number(event.target.value))}
              type="number"
              value={values.infants}
            />
          </label>
          <label>
            Budget style
            <select
              onChange={(event) =>
                update("budgetStyle", event.target.value as ReviewValues["budgetStyle"])
              }
              value={values.budgetStyle}
            >
              {["budget", "midrange", "premium", "luxury"].map((style) => (
                <option key={style}>{style}</option>
              ))}
            </select>
          </label>
          <label>
            Total budget (optional)
            <input
              min="0"
              onChange={(event) => update("budgetAmount", event.target.value)}
              type="number"
              value={values.budgetAmount}
            />
          </label>
          <label>
            Currency
            <input
              maxLength={3}
              onChange={(event) => update("currency", event.target.value.toUpperCase())}
              required
              value={values.currency}
            />
          </label>
        </fieldset>
        <fieldset>
          <legend>Pace, interests, and constraints</legend>
          <label>
            Pace
            <select
              onChange={(event) => update("pace", event.target.value as ReviewValues["pace"])}
              value={values.pace}
            >
              <option value="slow">Slow</option>
              <option value="balanced">Balanced</option>
              <option value="fast">Fast</option>
            </select>
          </label>
          <label>
            Interests, comma separated
            <input
              onChange={(event) => update("interests", event.target.value)}
              value={values.interests}
            />
          </label>
          <label>
            Dietary needs, comma separated
            <input
              onChange={(event) => update("dietary", event.target.value)}
              value={values.dietary}
            />
          </label>
          <label>
            Accessibility needs, comma separated
            <input
              onChange={(event) => update("accessibility", event.target.value)}
              value={values.accessibility}
            />
          </label>
          <label>
            Must do, comma separated
            <input
              onChange={(event) => update("mustDo", event.target.value)}
              value={values.mustDo}
            />
          </label>
          <label>
            Must avoid, comma separated
            <input
              onChange={(event) => update("mustAvoid", event.target.value)}
              value={values.mustAvoid}
            />
          </label>
        </fieldset>
        <div className="profile-preferences__actions">
          <Button disabled={!online} type="submit">
            Generate itinerary
          </Button>
        </div>
        <output aria-live="polite">{message}</output>
      </form>
      <TrustNotice>
        Your corrections are saved with this trip and used by the standard itinerary generator.
        Roavia never changes the itinerary without an explicit action.
      </TrustNotice>
    </section>
  );
}
