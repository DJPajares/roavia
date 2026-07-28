"use client";

import { createRoaviaApiClient, type Profile, type ProfileUpdateInput } from "@roavia/api-client";
import { Button, ExperienceState, TrustNotice } from "@roavia/ui";
import { useCallback, useEffect, useMemo, useState } from "react";

import { createClient } from "../lib/supabase/client";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

const interestOptions = ["Art", "Food", "History", "Nature", "Nightlife", "Wellness"];
const dietaryOptions = ["Halal", "Plant-based", "Vegan", "Vegetarian"];
const accessibilityOptions = ["Low walking", "Step-free routes", "Visual support"];

type FormProfile = Omit<Profile, "email" | "updatedAt">;

function toFormProfile(profile: Profile): FormProfile {
  const { email: _email, updatedAt: _updatedAt, ...formProfile } = profile;
  return formProfile;
}

function listValue(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toggleValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function ProfilePreferences({ email }: Readonly<{ email: string | undefined }>) {
  const [profile, setProfile] = useState<FormProfile | null>(null);
  const [state, setState] = useState<"error" | "loading" | "ready" | "saving">("loading");
  const [message, setMessage] = useState("");
  const api = useMemo(
    () =>
      createRoaviaApiClient({
        accessToken: async () =>
          (await createClient().auth.getSession()).data.session?.access_token ?? null,
        baseUrl: apiBaseUrl,
      }),
    [],
  );

  const loadProfile = useCallback(async () => {
    setState("loading");
    setMessage("");
    try {
      setProfile(toFormProfile((await api.getProfile()).data));
      setState("ready");
    } catch {
      setState("error");
      setMessage("We could not load your saved preferences. Nothing has been changed.");
    }
  }, [api]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  if (state === "loading" && !profile) {
    return (
      <ExperienceState
        detail="Loading the details Roavia can reuse when you plan."
        state="loading"
        title="Getting your travel profile"
      />
    );
  }
  if (state === "error" && !profile) {
    return (
      <ExperienceState
        action={
          <Button onClick={() => void loadProfile()} tone="quiet">
            Try again
          </Button>
        }
        detail={message}
        state="error"
        title="Your profile is not available right now"
      />
    );
  }
  if (!profile) return null;

  function update<K extends keyof FormProfile>(key: K, value: FormProfile[K]) {
    setProfile((current) => (current ? { ...current, [key]: value } : current));
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formProfile = profile;
    if (!formProfile) {
      return;
    }
    setState("saving");
    setMessage("");
    try {
      const input: ProfileUpdateInput = formProfile;
      setProfile(toFormProfile((await api.updateProfile(input)).data));
      setState("ready");
      setMessage("Your preferences are saved and will remain visible when you start a trip.");
    } catch (error) {
      setState("ready");
      setMessage(
        error instanceof Error
          ? error.message
          : "We could not save your preferences. Your edits are still here.",
      );
    }
  }

  return (
    <section aria-labelledby="profile-preferences-heading" className="profile-preferences">
      <div className="profile-preferences__intro">
        <p className="eyebrow">Your planning defaults</p>
        <h1 id="profile-preferences-heading">A profile that stays in your control.</h1>
        <p>
          Roavia uses these defaults only when you choose to apply them. Every trip can override
          them.
        </p>
        {email ? <p className="profile-preferences__identity">Signed in as {email}</p> : null}
      </div>

      <form className="profile-preferences__form" onSubmit={save}>
        <fieldset>
          <legend>Locale and money</legend>
          <label>
            Locale
            <input
              name="locale"
              onChange={(event) => update("locale", event.target.value)}
              value={profile.locale}
            />
          </label>
          <label>
            Home country
            <input
              maxLength={2}
              name="homeCountry"
              onChange={(event) =>
                update("homeCountry", event.target.value ? event.target.value.toUpperCase() : null)
              }
              value={profile.homeCountry ?? ""}
            />
          </label>
          <label>
            Preferred currency
            <input
              maxLength={3}
              name="preferredCurrency"
              onChange={(event) => update("preferredCurrency", event.target.value.toUpperCase())}
              value={profile.preferredCurrency}
            />
          </label>
          <label>
            Home time zone
            <input
              name="timezone"
              onChange={(event) => update("timezone", event.target.value)}
              value={profile.timezone}
            />
          </label>
        </fieldset>

        <fieldset>
          <legend>Planning style</legend>
          <label>
            Default budget
            <select
              name="defaultBudgetStyle"
              onChange={(event) =>
                update(
                  "defaultBudgetStyle",
                  event.target.value as FormProfile["defaultBudgetStyle"],
                )
              }
              value={profile.defaultBudgetStyle}
            >
              {["budget", "midrange", "premium", "luxury"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            Default pace
            <select
              name="defaultPace"
              onChange={(event) =>
                update("defaultPace", event.target.value as FormProfile["defaultPace"])
              }
              value={profile.defaultPace}
            >
              {["slow", "balanced", "fast"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        <PreferenceChoices
          label="Interests"
          options={interestOptions}
          values={profile.interests}
          onChange={(values) => update("interests", values)}
        />
        <PreferenceChoices
          label="Dietary needs"
          options={dietaryOptions}
          values={profile.dietaryNeeds}
          onChange={(values) => update("dietaryNeeds", values)}
        />
        <PreferenceChoices
          label="Accessibility needs"
          options={accessibilityOptions}
          values={profile.accessibilityNeeds}
          onChange={(values) => update("accessibilityNeeds", values)}
        />

        <fieldset>
          <legend>Trip-specific starting points</legend>
          <label>
            Usually want to do
            <textarea
              name="mustDo"
              onChange={(event) =>
                update("travelPreferences", {
                  ...profile.travelPreferences,
                  mustDo: listValue(event.target.value),
                })
              }
              value={profile.travelPreferences.mustDo.join(", ")}
            />
          </label>
          <label>
            Usually avoid
            <textarea
              name="mustAvoid"
              onChange={(event) =>
                update("travelPreferences", {
                  ...profile.travelPreferences,
                  mustAvoid: listValue(event.target.value),
                })
              }
              value={profile.travelPreferences.mustAvoid.join(", ")}
            />
          </label>
          <p>Separate ideas with commas. These are prompts for you to review, not hidden rules.</p>
        </fieldset>

        <div className="profile-preferences__actions">
          <Button disabled={state === "saving"} type="submit">
            {state === "saving" ? "Saving…" : "Save preferences"}
          </Button>
          <p aria-live="polite" role={message && state === "ready" ? "status" : undefined}>
            {message}
          </p>
        </div>
      </form>
      <TrustNotice>
        Roavia keeps your preferences scoped to your account. They are never shared with a trip
        link.
      </TrustNotice>
    </section>
  );
}

function PreferenceChoices({
  label,
  onChange,
  options,
  values,
}: Readonly<{
  label: string;
  onChange: (values: string[]) => void;
  options: string[];
  values: string[];
}>) {
  return (
    <fieldset>
      <legend>{label}</legend>
      <div aria-label={label} className="profile-preferences__choices">
        {options.map((option) => (
          <label key={option}>
            <input
              checked={values.includes(option)}
              onChange={() => onChange(toggleValue(values, option))}
              type="checkbox"
            />
            {option}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
