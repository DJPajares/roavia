"use client";

import { ApiClientError, createRoaviaApiClient } from "@roavia/api-client";
import type {
  AssistantActionPreview,
  AssistantActionStatus,
  AssistantAnswer,
  Trip,
} from "@roavia/contracts";
import { Button, ExperienceState, TrustNotice } from "@roavia/ui";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { createClient } from "../lib/supabase/client";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

function errorMessage(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.status === 401)
      return "Your session has expired. Sign in again to use the assistant.";
    if (error.code === "assistant_action_conflict") {
      return "That preview is no longer current. Ask again to review a fresh action.";
    }
    if (error.code === "rate_limited")
      return "You have asked several questions. Try again shortly.";
  }
  return error instanceof Error
    ? error.message
    : "The assistant could not complete that request. Your trip is unchanged.";
}

function actionLabel(action: AssistantActionPreview) {
  const labels: Record<AssistantActionPreview["payload"]["kind"], string> = {
    add_place: "Add place",
    remove_item: "Remove item",
    reorder_item: "Reorder item",
    replace_item: "Replace item",
    save_note: "Save note",
  };
  return labels[action.payload.kind];
}

function SourceReview({ answer }: Readonly<{ answer: AssistantAnswer }>) {
  if (answer.sources.length === 0) return null;
  return (
    <section aria-labelledby="assistant-sources-heading" className="assistant-sources">
      <div className="assistant-section-heading">
        <p className="eyebrow">Evidence</p>
        <h2 id="assistant-sources-heading">Review the sources</h2>
      </div>
      <ul>
        {answer.sources.map((source) => (
          <li key={source.sourceId}>
            <div>
              <a href={source.url} rel="noreferrer" target="_blank">
                {source.title}
              </a>
              <span>{source.official ? "Official source" : "Approved source"}</span>
            </div>
            <div className="assistant-source-meta">
              <span className={`is-${source.freshness}`}>{source.freshness}</span>
              <time dateTime={source.retrievedAt}>
                Retrieved {new Date(source.retrievedAt).toLocaleDateString()}
              </time>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface ActionPreviewProps {
  action: AssistantActionPreview;
  busy: boolean;
  onDecision: (action: AssistantActionPreview, decision: "cancel" | "confirm") => void;
}

function ActionPreview({ action, busy, onDecision }: Readonly<ActionPreviewProps>) {
  const decided = action.status !== "pending";
  return (
    <li className="assistant-action">
      <div>
        <span>{actionLabel(action)}</span>
        <strong>{action.payload.summary}</strong>
        <small>Trip revision {action.expectedTripRevision} · no change until you confirm</small>
      </div>
      {decided ? (
        <output className={`assistant-action__status is-${action.status}`}>{action.status}</output>
      ) : (
        <div className="assistant-action__controls">
          <Button
            aria-label={`Confirm: ${action.payload.summary}`}
            disabled={busy}
            onClick={() => onDecision(action, "confirm")}
          >
            Confirm
          </Button>
          <Button
            aria-label={`Cancel: ${action.payload.summary}`}
            disabled={busy}
            onClick={() => onDecision(action, "cancel")}
            tone="quiet"
          >
            Cancel
          </Button>
        </div>
      )}
    </li>
  );
}

export function AssistantWorkspace({ email }: Readonly<{ email?: string }>) {
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [loadingTrips, setLoadingTrips] = useState(true);
  const [message, setMessage] = useState("");
  const [offline, setOffline] = useState(false);
  const [question, setQuestion] = useState("");
  const [selectedTripId, setSelectedTripId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [trips, setTrips] = useState<Trip[]>([]);
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
    let active = true;
    void (async () => {
      try {
        const response = await api.listTrips({ limit: 50 });
        if (!active) return;
        setTrips(response.data.trips);
        setSelectedTripId(response.data.trips[0]?.id ?? "");
      } catch (error) {
        if (active) setMessage(errorMessage(error));
      } finally {
        if (active) setLoadingTrips(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [api]);

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

  async function ask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (offline || !selectedTripId || question.trim().length < 3) return;
    setSubmitting(true);
    setMessage("");
    setAnswer(null);
    try {
      const response = await api.askAssistant({
        context: { tripId: selectedTripId, type: "trip" },
        locale: navigator.language || "en",
        question: question.trim(),
      });
      setAnswer(response.data);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function decide(action: AssistantActionPreview, decision: "cancel" | "confirm") {
    if (offline) {
      setMessage("Reconnect before deciding on an assistant action. Your trip is unchanged.");
      return;
    }
    setBusyActionId(action.actionId);
    setMessage("");
    try {
      const response =
        decision === "confirm"
          ? await api.confirmAssistantAction(action.actionId)
          : await api.cancelAssistantAction(action.actionId);
      const status: AssistantActionStatus = response.data.status;
      setAnswer((current) =>
        current
          ? {
              ...current,
              actions: current.actions.map((candidate) =>
                candidate.actionId === action.actionId ? { ...candidate, status } : candidate,
              ),
            }
          : current,
      );
      setMessage(
        status === "applied"
          ? "The confirmed change was applied through your trip controls."
          : "The preview was cancelled. Your trip was not changed.",
      );
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusyActionId(null);
    }
  }

  if (loadingTrips) {
    return (
      <ExperienceState
        detail="Loading the trips available for grounded questions."
        headingLevel={1}
        state="loading"
        title="Preparing the assistant"
      />
    );
  }

  if (trips.length === 0 && message) {
    return (
      <ExperienceState
        detail={message}
        headingLevel={1}
        state={offline ? "offline" : "error"}
        title="The assistant is not available yet"
      />
    );
  }

  if (trips.length === 0) {
    return (
      <ExperienceState
        action={
          <Link className="roavia-button roavia-button--accent" href="/plan">
            Plan a trip
          </Link>
        }
        detail="Create a trip with a destination so Roavia has approved context to retrieve."
        headingLevel={1}
        state="empty"
        title="Add a trip before asking"
      />
    );
  }

  return (
    <section aria-labelledby="assistant-heading" className="assistant-workspace">
      <header className="assistant-hero">
        <p className="eyebrow">Grounded travel support</p>
        <h1 id="assistant-heading">Ask clearly. Decide deliberately.</h1>
        <p>
          Roavia answers from approved trip and destination context, then keeps every proposed trip
          change behind your confirmation.
        </p>
        {email ? <span>Private workspace for {email}</span> : null}
      </header>

      <form className="assistant-composer" onSubmit={ask}>
        <label htmlFor="assistant-trip">Trip context</label>
        <select
          id="assistant-trip"
          onChange={(event) => {
            setSelectedTripId(event.target.value);
            setAnswer(null);
          }}
          value={selectedTripId}
        >
          {trips.map((trip) => (
            <option key={trip.id} value={trip.id}>
              {trip.title}
            </option>
          ))}
        </select>
        <label htmlFor="assistant-question">Your question</label>
        <textarea
          id="assistant-question"
          maxLength={1_000}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="What should I know before taking the train to my next stop?"
          rows={4}
          value={question}
        />
        <div className="assistant-composer__footer">
          <span>{question.length}/1,000</span>
          <Button disabled={submitting || offline || question.trim().length < 3} type="submit">
            {submitting ? "Checking sources…" : "Ask Roavia"}
          </Button>
        </div>
      </form>

      {offline ? (
        <output className="assistant-message is-warning">
          You are offline. Reconnect to ask or decide on a proposed change.
        </output>
      ) : null}
      {message ? (
        <output className="assistant-message" aria-live="polite">
          {message}
        </output>
      ) : null}

      {answer ? (
        <div className="assistant-result">
          <article className={`assistant-answer is-${answer.status}`}>
            <div className="assistant-answer__status">
              <span>{answer.status.replaceAll("_", " ")}</span>
              <span>{answer.uncertainty.level} uncertainty</span>
            </div>
            <h2>Roavia’s answer</h2>
            <p>{answer.answer}</p>
            <p className="assistant-answer__uncertainty">{answer.uncertainty.explanation}</p>
            {answer.safety.disclaimer ? (
              <aside className="assistant-answer__safety">
                <strong>Verify before you act</strong>
                <p>{answer.safety.disclaimer}</p>
              </aside>
            ) : null}
            {answer.evidence.gaps.length > 0 ? (
              <details>
                <summary>Evidence gaps ({answer.evidence.gaps.length})</summary>
                <ul>
                  {answer.evidence.gaps.map((gap) => (
                    <li key={gap}>{gap}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </article>

          <SourceReview answer={answer} />

          {answer.actions.length > 0 ? (
            <section aria-labelledby="assistant-actions-heading" className="assistant-actions">
              <div className="assistant-section-heading">
                <p className="eyebrow">Your decision</p>
                <h2 id="assistant-actions-heading">Review proposed changes</h2>
                <p>Each preview is one-time and tied to the trip version you asked about.</p>
              </div>
              <ul>
                {answer.actions.map((action) => (
                  <ActionPreview
                    action={action}
                    busy={busyActionId !== null}
                    key={action.actionId}
                    onDecision={(candidate, decision) => void decide(candidate, decision)}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

      <TrustNotice label="How Roavia answers">
        Source links, freshness, and uncertainty stay visible. Visa, safety, emergency, and medical
        questions require approved official evidence and a verification reminder.
      </TrustNotice>
    </section>
  );
}
