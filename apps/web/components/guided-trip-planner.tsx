"use client";

import { ApiClientError, createRoaviaApiClient } from "@roavia/api-client";
import type { Profile, TripCreateInput, TripUpdateInput } from "@roavia/contracts";
import { Button, ExperienceState, TrustNotice } from "@roavia/ui";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { createClient } from "../lib/supabase/client";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

type Step = "details" | "review";
type PlannerState = "loading" | "ready" | "saving" | "unavailable";

interface FormValues {
  adults: number;
  budgetAmount: string;
  budgetStyle: TripCreateInput["budget"]["style"];
  currency: string;
  endDate: string;
  startDate: string;
  title: string;
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
  return error instanceof Error
    ? error.message
    : "We could not save your draft. Your details are still here.";
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

export function GuidedTripPlanner({ resumeTripId }: Readonly<{ resumeTripId?: string }>) {
  const [preferences, setPreferences] = useState<Profile | null>(null);
  const [values, setValues] = useState<FormValues>(initialValues);
  const [state, setState] = useState<PlannerState>("loading");
  const [step, setStep] = useState<Step>("details");
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState<number | null>(null);
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
    setPreferences(profileResult.value.data);
    if (tripResult.status === "fulfilled" && tripResult.value) {
      const trip = tripResult.value.data;
      setValues({
        adults: trip.travelerSummary.adults,
        budgetAmount: trip.budget.amountMinor === null ? "" : String(trip.budget.amountMinor / 100),
        budgetStyle: trip.budget.style,
        currency: trip.budget.currency,
        endDate: trip.endDate,
        startDate: trip.startDate,
        title: trip.title,
      });
      setRevision(trip.revision);
      setMessage("Your saved draft has been restored. Review and update anything you need.");
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

  function review(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      toInput(values);
      setMessage("");
      setStep("review");
    } catch {
      setMessage(
        "Check the trip title, valid dates, travelers, and budget before reviewing your plan.",
      );
    }
  }

  async function saveDraft() {
    setState("saving");
    setMessage("");
    try {
      const input = toInput(values);
      const trip =
        resumeTripId && revision
          ? await api.updateTrip(resumeTripId, {
              ...input,
              expectedRevision: revision,
            } satisfies TripUpdateInput)
          : await api.createTrip(input);
      setRevision(trip.data.revision);
      setMessage(`${trip.data.title} is saved as a draft. You can return to it from Trips.`);
      setStep("details");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setState("ready");
    }
  }

  if (state === "loading") {
    return (
      <ExperienceState
        detail="Loading the preferences you can choose to apply."
        headingLevel={1}
        state="loading"
        title="Starting your plan"
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
        title="Planning preferences are unavailable"
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
    <section aria-labelledby="guided-trip-heading" className="profile-preferences">
      <div className="profile-preferences__intro">
        <p className="eyebrow">Guided planning</p>
        <h1 id="guided-trip-heading">Start with the choices that matter.</h1>
        <p>
          Saved preferences are visible starting points, never hidden rules. You can change every
          trip detail here.
        </p>
      </div>

      {step === "details" ? (
        <form className="profile-preferences__form" onSubmit={review}>
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
              <legend>Applied preferences — editable per trip</legend>
              <p>{applied.join(" · ")}</p>
              <p>These details will be shown again for review before any itinerary generation.</p>
            </fieldset>
          ) : null}
          <div className="profile-preferences__actions">
            <Button disabled={state === "saving"} type="submit">
              Review assumptions
            </Button>
            <output>{message}</output>
          </div>
        </form>
      ) : (
        <section className="profile-preferences__form" aria-labelledby="trip-review-heading">
          <p className="eyebrow">Review before generation</p>
          <h2 id="trip-review-heading">Your draft is still yours.</h2>
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
          </dl>
          {applied.length ? (
            <p>
              <strong>Visible assumptions:</strong> {applied.join(" · ")}
            </p>
          ) : (
            <p>No saved preferences were applied.</p>
          )}
          <div className="profile-preferences__actions">
            <Button disabled={state === "saving"} onClick={() => void saveDraft()}>
              {state === "saving" ? "Saving…" : "Save draft"}
            </Button>
            <Button disabled={state === "saving"} onClick={() => setStep("details")} tone="quiet">
              Edit details
            </Button>
            <Link className="roavia-button roavia-button--quiet" href="/trips">
              View trips
            </Link>
          </div>
          <output>{message}</output>
        </section>
      )}
      <TrustNotice>
        Roavia saves a draft only when you choose Save draft. It will not generate or change an
        itinerary without your review.
      </TrustNotice>
    </section>
  );
}
