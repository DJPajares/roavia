"use client";

import { ApiClientError, type RoaviaApiClient } from "@roavia/api-client";
import type {
  DisruptionRecommendation,
  DisruptionRecommendationListResponse,
} from "@roavia/contracts";
import { Button, ExperienceState } from "@roavia/ui";
import { useCallback, useEffect, useRef, useState } from "react";

type LiveDataStatus = DisruptionRecommendationListResponse["data"]["liveDataStatus"];

function formatMoment(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function errorMessage(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.status === 401) return "Your session expired. Sign in again before deciding.";
    if (error.code === "disruption_recommendation_conflict") {
      return "This live condition or itinerary item changed. Refresh to review current advice.";
    }
    if (error.code === "disruption_service_unavailable") {
      return "Live alternatives are unavailable. Your saved itinerary is unchanged.";
    }
  }
  return error instanceof Error
    ? error.message
    : "The decision could not be saved. Your itinerary is unchanged.";
}

function statusMessage(status: LiveDataStatus) {
  if (status === "provider_unavailable") {
    return "The recommendation provider is unavailable. Roavia will not suggest an unsupported change.";
  }
  if (status === "stale") {
    return "Live condition evidence is stale. Roavia is withholding alternatives until fresh data arrives.";
  }
  return null;
}

function RecommendationCard({
  busy,
  offline,
  onApply,
  onDecision,
  recommendation,
}: Readonly<{
  busy: boolean;
  offline: boolean;
  onApply: (recommendation: DisruptionRecommendation, trigger: HTMLButtonElement) => void;
  onDecision: (recommendation: DisruptionRecommendation, decision: "dismiss" | "keep") => void;
  recommendation: DisruptionRecommendation;
}>) {
  const disabled = busy || offline || recommendation.status === "applying";
  return (
    <article
      aria-labelledby={`disruption-recommendation-${recommendation.id}`}
      className="disruption-recommendation"
    >
      <header className="disruption-recommendation__heading">
        <div>
          <p className="eyebrow">
            {recommendation.impact.severity} {recommendation.impact.kind} impact
          </p>
          <h3 id={`disruption-recommendation-${recommendation.id}`}>
            Review an alternative for {recommendation.original.name}
          </h3>
        </div>
        <span
          className={`disruption-recommendation__confidence is-${recommendation.confidence.level}`}
        >
          {recommendation.confidence.level} confidence ·{" "}
          {Math.round(recommendation.confidence.score * 100)}%
        </span>
      </header>

      <section aria-label="Why this changed" className="disruption-recommendation__reason">
        <strong>Why Roavia is suggesting a review</strong>
        <p>{recommendation.impact.reason}</p>
        <p>{recommendation.confidence.explanation}</p>
        <span>
          Source:{" "}
          <a href={recommendation.impact.source.url} rel="noreferrer" target="_blank">
            {recommendation.impact.source.title}
          </a>{" "}
          · updated {formatMoment(recommendation.impact.source.updatedAt)}
        </span>
      </section>

      <div
        aria-label="Original and proposed itinerary comparison"
        className="disruption-comparison"
      >
        <section className="disruption-comparison__item is-original">
          <span>Keep original</span>
          <strong>{recommendation.original.name}</strong>
          <p>
            {recommendation.original.localDate} · {recommendation.original.timeLabel}
          </p>
        </section>
        <span aria-hidden="true" className="disruption-comparison__arrow">
          →
        </span>
        <section className="disruption-comparison__item is-alternative">
          <span>Proposed alternative</span>
          <strong>{recommendation.alternative.name}</strong>
          <p>
            {recommendation.alternative.localDate} · {recommendation.alternative.timeLabel}
          </p>
          <p>{recommendation.alternative.explanation}</p>
          <small>
            Alternative source:{" "}
            <a href={recommendation.alternative.source.url} rel="noreferrer" target="_blank">
              {recommendation.alternative.source.title}
            </a>{" "}
            · retrieved {formatMoment(recommendation.alternative.source.retrievedAt)}
          </small>
        </section>
      </div>

      {recommendation.status === "failed" ? (
        <output className="disruption-recommendation__failure">
          The alternative was not applied. Your original itinerary item remains unchanged.
        </output>
      ) : null}

      <div
        aria-label={`Decision for ${recommendation.original.name}`}
        className="disruption-recommendation__actions"
      >
        <Button disabled={disabled} onClick={() => onDecision(recommendation, "keep")} tone="quiet">
          Keep original
        </Button>
        <Button
          disabled={disabled}
          onClick={() => onDecision(recommendation, "dismiss")}
          tone="quiet"
        >
          Dismiss
        </Button>
        {recommendation.status === "pending" ? (
          <Button
            disabled={disabled}
            onClick={(event) => onApply(recommendation, event.currentTarget)}
          >
            Apply alternative
          </Button>
        ) : null}
      </div>
    </article>
  );
}

export function DisruptionRecommendations({
  api,
  offline,
  onApplied,
  tripId,
}: Readonly<{
  api: RoaviaApiClient;
  offline: boolean;
  onApplied: () => Promise<void>;
  tripId: string;
}>) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<DisruptionRecommendation | null>(null);
  const [liveDataStatus, setLiveDataStatus] = useState<LiveDataStatus>("none");
  const [loading, setLoading] = useState(!offline);
  const [message, setMessage] = useState("");
  const [recommendations, setRecommendations] = useState<DisruptionRecommendation[]>([]);
  const applyTriggerRef = useRef<HTMLButtonElement | null>(null);
  const reviewAgainRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (confirming) {
      reviewAgainRef.current?.focus();
    } else {
      applyTriggerRef.current?.focus();
    }
  }, [confirming]);

  const refresh = useCallback(async () => {
    if (offline) return;
    setLoading(true);
    setMessage("");
    try {
      const response = await api.refreshDisruptionRecommendations(tripId);
      setRecommendations(response.data.recommendations);
      setLiveDataStatus(response.data.liveDataStatus);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [api, offline, tripId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function decide(recommendation: DisruptionRecommendation, decision: "dismiss" | "keep") {
    if (offline || busyId) return;
    setBusyId(recommendation.id);
    setMessage("");
    try {
      const response = await api.decideDisruptionRecommendation(tripId, recommendation.id, {
        decision,
      });
      setRecommendations((current) => current.filter(({ id }) => id !== recommendation.id));
      setMessage(
        response.data.status === "kept"
          ? "Original kept. Roavia will not repeat this source event."
          : "Recommendation dismissed. It will not immediately reappear for this source event.",
      );
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  async function applyConfirmed() {
    const recommendation = confirming;
    if (!recommendation || offline || busyId) return;
    setBusyId(recommendation.id);
    setMessage("");
    try {
      await api.applyDisruptionRecommendation(tripId, recommendation.id);
      setRecommendations((current) => current.filter(({ id }) => id !== recommendation.id));
      setConfirming(null);
      setMessage("Alternative applied through the confirmed trip-change path.");
      await onApplied();
    } catch (error) {
      setConfirming(null);
      setRecommendations((current) =>
        current.map((candidate) =>
          candidate.id === recommendation.id ? { ...candidate, status: "failed" } : candidate,
        ),
      );
      setMessage(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  const unavailableMessage = offline
    ? "Live alternatives are unavailable offline. Your saved itinerary remains unchanged."
    : statusMessage(liveDataStatus);

  if (loading && recommendations.length === 0) {
    return (
      <section aria-label="Live disruption alternatives" className="disruption-recommendations">
        <ExperienceState
          detail="Checking fresh weather and closure evidence without changing your itinerary."
          state="loading"
          title="Reviewing live changes"
        />
      </section>
    );
  }

  if (recommendations.length === 0 && !message && !unavailableMessage) return null;

  return (
    <section
      aria-labelledby="disruption-recommendations-heading"
      className="disruption-recommendations"
    >
      <div className="disruption-recommendations__heading">
        <div>
          <p className="eyebrow">Live trip review</p>
          <h2 id="disruption-recommendations-heading">Changes worth your decision</h2>
          <p>
            Compare each source-backed alternative. Nothing changes until you explicitly apply it.
          </p>
        </div>
        {!offline ? (
          <Button disabled={loading || busyId !== null} onClick={() => void refresh()} tone="quiet">
            Refresh live advice
          </Button>
        ) : null}
      </div>

      {unavailableMessage ? (
        <output className="disruption-recommendations__notice">{unavailableMessage}</output>
      ) : null}
      {message ? (
        <output aria-live="polite" className="disruption-recommendations__notice">
          {message}
        </output>
      ) : null}

      {recommendations.length > 0 ? (
        <div className="disruption-recommendations__list">
          {recommendations.map((recommendation) => (
            <RecommendationCard
              busy={busyId !== null}
              key={recommendation.id}
              offline={offline}
              onApply={(candidate, trigger) => {
                applyTriggerRef.current = trigger;
                setConfirming(candidate);
              }}
              onDecision={(candidate, decision) => void decide(candidate, decision)}
              recommendation={recommendation}
            />
          ))}
        </div>
      ) : null}

      {confirming ? (
        <div className="itinerary-editor-backdrop">
          <section
            aria-labelledby="confirm-disruption-alternative-heading"
            aria-modal="true"
            className="itinerary-remove-dialog disruption-confirmation"
            role="alertdialog"
          >
            <p className="eyebrow">Confirm replacement</p>
            <h2 id="confirm-disruption-alternative-heading">
              Replace {confirming.original.name} with {confirming.alternative.name}?
            </h2>
            <p>
              This changes one itinerary item through Roavia’s confirmed trip controls. If the save
              fails, the original item remains in place.
            </p>
            <div className="itinerary-editor__actions">
              <button
                className="roavia-button roavia-button--quiet"
                disabled={busyId !== null}
                onClick={() => setConfirming(null)}
                ref={reviewAgainRef}
                type="button"
              >
                Review again
              </button>
              <Button disabled={busyId !== null} onClick={() => void applyConfirmed()}>
                {busyId ? "Applying…" : "Confirm replacement"}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
