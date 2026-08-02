"use client";

import type { DestinationSeasonalInsight, DestinationSeasonalityQuery } from "@roavia/contracts";
import { ExperienceState } from "@roavia/ui";
import { useEffect, useMemo, useState } from "react";

import { roaviaApi } from "../lib/api";

type CalendarState = "error" | "loading" | "offline" | "ready";
type View = "month" | "range";

const priorityFields: Array<{
  description: string;
  key: keyof DestinationSeasonalityQuery;
  label: string;
}> = [
  { description: "Weather, rainfall, and temperature", key: "weather", label: "Weather" },
  { description: "Qualitative price signals", key: "budget", label: "Budget" },
  { description: "Qualitative crowd signals", key: "crowds", label: "Crowds" },
  { description: "Festivals and holidays", key: "festivals", label: "Festivals" },
  { description: "Known closure evidence", key: "closures", label: "Closures" },
];

const calendarMonths = Array.from({ length: 12 }, (_, index) => index + 1);
const signalLabels: Record<keyof DestinationSeasonalInsight["signals"], string> = {
  closures: "Closures",
  crowds: "Crowds",
  festivals: "Festivals",
  holidays: "Holidays",
  prices: "Prices",
  rainfall: "Rainfall",
  temperature: "Temperature",
  weather: "Weather",
};

function monthName(month: number, format: "long" | "short" = "long") {
  return new Intl.DateTimeFormat(undefined, { month: format, timeZone: "UTC" }).format(
    new Date(Date.UTC(2027, month - 1, 1)),
  );
}

function periodLabel(insight: DestinationSeasonalInsight) {
  if (insight.period.kind === "month")
    return `${monthName(insight.period.month)} ${insight.period.year}`;
  return `${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(`${insight.period.startDate}T00:00:00Z`),
  )} – ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(`${insight.period.endDate}T00:00:00Z`),
  )}`;
}

function ratingLabel(rating: DestinationSeasonalInsight["rating"]) {
  return {
    challenging: "Tradeoffs expected",
    favorable: "Favorable signals",
    insufficient_evidence: "Evidence limited",
    mixed: "Mixed signals",
    very_favorable: "Strong signals",
  }[rating];
}

function signalStateLabel(state: DestinationSeasonalInsight["signals"]["weather"]["state"]) {
  return {
    available: "Available",
    conflicting: "Sources conflict",
    missing: "Not available",
    stale: "Needs refresh",
  }[state];
}

function confidenceLabel(confidence: number) {
  if (confidence >= 0.75) return "Higher confidence";
  if (confidence >= 0.45) return "Moderate confidence";
  return "Limited confidence";
}

function isoMonth(year: number, month: number, end = false) {
  const day = end ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isInRange(insight: DestinationSeasonalInsight, startDate: string, endDate: string) {
  const startsAt =
    insight.period.kind === "month"
      ? isoMonth(insight.period.year, insight.period.month)
      : insight.period.startDate;
  const endsAt =
    insight.period.kind === "month"
      ? isoMonth(insight.period.year, insight.period.month, true)
      : insight.period.endDate;
  return startsAt <= endDate && endsAt >= startDate;
}

function SignalDetails({ insight }: { insight: DestinationSeasonalInsight }) {
  return (
    <section aria-labelledby="seasonal-signal-heading" className="best-time-calendar__signals">
      <div>
        <p className="eyebrow">Signal notes</p>
        <h3 id="seasonal-signal-heading">Why this period changes</h3>
      </div>
      <dl>
        {Object.entries(insight.signals).map(([signal, detail]) => (
          <div key={signal}>
            <dt>{signalLabels[signal as keyof typeof signalLabels]}</dt>
            <dd>
              <strong className={`best-time-calendar__signal-state is-${detail.state}`}>
                {signalStateLabel(detail.state)}
              </strong>
              <span>
                {detail.evidence[0]?.summary ??
                  "No supported evidence is available for this period yet."}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function BestTimeCalendar({ placeId }: { placeId: string }) {
  const [state, setState] = useState<CalendarState>("loading");
  const [insights, setInsights] = useState<DestinationSeasonalInsight[]>([]);
  const [priorities, setPriorities] = useState<DestinationSeasonalityQuery>({
    budget: 1,
    closures: 1,
    crowds: 1,
    festivals: 1,
    weather: 1,
  });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [view, setView] = useState<View>("month");

  useEffect(() => {
    let active = true;
    if (!navigator.onLine) {
      setState("offline");
      return () => {
        active = false;
      };
    }
    setState("loading");
    void roaviaApi
      .getDestinationSeasonality(placeId, priorities)
      .then((response) => {
        if (!active) return;
        setInsights(response.data.insights);
        const firstMonth = response.data.insights.find(
          (insight) => insight.period.kind === "month",
        );
        if (firstMonth?.period.kind === "month") {
          const firstDate = isoMonth(firstMonth.period.year, firstMonth.period.month);
          setRangeStart((current) => current || firstDate);
          setRangeEnd((current) => current || firstDate);
        }
        setSelectedKey((current) =>
          response.data.insights.some((insight) => insight.periodKey === current)
            ? current
            : (response.data.insights.find((insight) => insight.period.kind === "month")
                ?.periodKey ??
              response.data.insights[0]?.periodKey ??
              null),
        );
        setState("ready");
        return undefined;
      })
      .catch(() => {
        if (active) setState("error");
        return undefined;
      });
    return () => {
      active = false;
    };
  }, [placeId, priorities]);

  const monthInsights = useMemo(
    () => insights.filter((insight) => insight.period.kind === "month"),
    [insights],
  );
  const calendarYear =
    monthInsights[0]?.period.kind === "month" ? monthInsights[0].period.year : 2027;
  const selected = insights.find((insight) => insight.periodKey === selectedKey) ?? null;
  const defaultStart =
    selected?.period.kind === "month" ? isoMonth(calendarYear, selected.period.month) : "";
  const [rangeStart, setRangeStart] = useState(defaultStart);
  const [rangeEnd, setRangeEnd] = useState(defaultStart);
  const rangeInsights =
    rangeStart && rangeEnd && rangeStart <= rangeEnd
      ? insights.filter((insight) => isInRange(insight, rangeStart, rangeEnd))
      : [];

  if (state === "offline") {
    return (
      <section className="best-time-calendar">
        <ExperienceState
          detail="Reconnect to compare live seasonal evidence. Roavia will not invent a best-time recommendation offline."
          state="offline"
          title="Seasonal guidance needs a connection"
        />
      </section>
    );
  }
  if (state === "error") {
    return (
      <section className="best-time-calendar">
        <ExperienceState
          detail="The seasonal data provider did not return a usable comparison. Your destination guide remains available."
          state="error"
          title="Seasonal guidance is unavailable"
        />
      </section>
    );
  }
  if (state === "loading" && insights.length === 0) {
    return (
      <section
        aria-busy="true"
        aria-live="polite"
        className="best-time-calendar best-time-calendar--loading"
      >
        <p className="eyebrow">Best time</p>
        <h2>Comparing seasonal evidence</h2>
        <p>Loading source-aware weather, crowd, price, and calendar signals.</p>
      </section>
    );
  }
  if (insights.length === 0) {
    return (
      <section className="best-time-calendar">
        <ExperienceState
          detail="No approved seasonal evidence is available for this destination yet. We will not substitute generic travel advice."
          state="empty"
          title="Seasonal guide still under review"
        />
      </section>
    );
  }

  const setPriority = (key: keyof DestinationSeasonalityQuery, value: string) => {
    setPriorities((current) => ({ ...current, [key]: Number(value) }));
  };

  return (
    <section aria-labelledby="best-time-heading" className="best-time-calendar">
      <header className="best-time-calendar__heading">
        <div>
          <p className="eyebrow">Best time, explained</p>
          <h2 id="best-time-heading">Compare the tradeoffs</h2>
          <p>
            Adjust what matters, then read the supporting signals. Roavia does not claim one
            universal best period.
          </p>
        </div>
        <p aria-live="polite" className="best-time-calendar__live">
          {state === "loading" ? "Updating guidance for your priorities." : "Guidance updated."}
        </p>
      </header>

      <fieldset className="best-time-calendar__priorities">
        <legend>What matters for this trip</legend>
        <p>
          Move a priority from low to high. The ratings and explanations update from the same
          evidence.
        </p>
        <div>
          {priorityFields.map(({ description, key, label }) => (
            <label key={key}>
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
              <input
                aria-valuetext={`${priorities[key] ?? 1} out of 5 priority for ${label.toLowerCase()}`}
                max="5"
                min="0"
                onChange={(event) => setPriority(key, event.target.value)}
                type="range"
                value={priorities[key] ?? 1}
              />
              <output>{priorities[key] ?? 1}</output>
            </label>
          ))}
        </div>
      </fieldset>

      <div
        aria-label="Seasonal comparison view"
        className="best-time-calendar__tabs"
        role="tablist"
      >
        <button
          aria-controls="seasonal-month-panel"
          aria-selected={view === "month"}
          id="seasonal-month-tab"
          onClick={() => setView("month")}
          role="tab"
          type="button"
        >
          Months
        </button>
        <button
          aria-controls="seasonal-range-panel"
          aria-selected={view === "range"}
          id="seasonal-range-tab"
          onClick={() => setView("range")}
          role="tab"
          type="button"
        >
          Flexible dates
        </button>
      </div>

      {view === "month" ? (
        <div
          aria-labelledby="seasonal-month-tab"
          className="best-time-calendar__month-view"
          id="seasonal-month-panel"
          role="tabpanel"
        >
          <div className="best-time-calendar__calendar-heading">
            <h3>{calendarYear} seasonal signals</h3>
            <p>Every month includes a text rating; color is never the only signal.</p>
          </div>
          <ol aria-label={`${calendarYear} seasonal calendar`} className="best-time-calendar__grid">
            {calendarMonths.map((month) => {
              const insight = monthInsights.find(
                (item) => item.period.kind === "month" && item.period.month === month,
              );
              const isSelected = insight?.periodKey === selected?.periodKey;
              return (
                <li key={month}>
                  {insight ? (
                    <button
                      aria-pressed={isSelected}
                      className={`best-time-calendar__month is-${insight.rating}`}
                      onClick={() => setSelectedKey(insight.periodKey)}
                      type="button"
                    >
                      <span>{monthName(month, "short")}</span>
                      <strong>{ratingLabel(insight.rating)}</strong>
                      <small>{confidenceLabel(insight.confidence)}</small>
                    </button>
                  ) : (
                    <div className="best-time-calendar__month is-unavailable">
                      <span>{monthName(month, "short")}</span>
                      <strong>Not reviewed</strong>
                      <small>Evidence unavailable</small>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      ) : (
        <div
          aria-labelledby="seasonal-range-tab"
          className="best-time-calendar__range-view"
          id="seasonal-range-panel"
          role="tabpanel"
        >
          <div className="best-time-calendar__range-controls">
            <label>
              Start date
              <input
                onChange={(event) => setRangeStart(event.target.value)}
                type="date"
                value={rangeStart}
              />
            </label>
            <label>
              End date
              <input
                onChange={(event) => setRangeEnd(event.target.value)}
                type="date"
                value={rangeEnd}
              />
            </label>
          </div>
          {rangeStart && rangeEnd && rangeStart > rangeEnd ? (
            <p className="best-time-calendar__range-error" role="alert">
              Choose an end date after the start date.
            </p>
          ) : rangeInsights.length === 0 ? (
            <ExperienceState
              detail="No approved monthly or date-range records overlap these dates. Try a different range or check back after the next refresh."
              state="empty"
              title="No comparable seasonal evidence"
            />
          ) : (
            <div className="best-time-calendar__range-results">
              <p>
                Comparing {rangeInsights.length} evidence period
                {rangeInsights.length === 1 ? "" : "s"}. This remains a tradeoff view, not a booking
                recommendation.
              </p>
              <ul>
                {rangeInsights.map((insight) => (
                  <li key={insight.periodKey}>
                    <button onClick={() => setSelectedKey(insight.periodKey)} type="button">
                      <span>{periodLabel(insight)}</span>
                      <strong>{ratingLabel(insight.rating)}</strong>
                      <small>{insight.explanation.summary}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {selected ? (
        <section
          aria-labelledby="seasonal-selection-heading"
          className="best-time-calendar__selection"
        >
          <header>
            <div>
              <p className="eyebrow">Selected period</p>
              <h3 id="seasonal-selection-heading">{periodLabel(selected)}</h3>
            </div>
            <span className={`best-time-calendar__rating is-${selected.rating}`}>
              {ratingLabel(selected.rating)}
            </span>
          </header>
          <p className="best-time-calendar__summary">{selected.explanation.summary}</p>
          <ul className="best-time-calendar__tradeoffs">
            {selected.explanation.tradeoffs.map((tradeoff) => (
              <li key={tradeoff}>{tradeoff}</li>
            ))}
          </ul>
          <SignalDetails insight={selected} />
          <footer className="best-time-calendar__trust">
            <p>
              {confidenceLabel(selected.confidence)} · refreshed{" "}
              <time dateTime={selected.refreshedAt}>
                {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
                  new Date(selected.refreshedAt),
                )}
              </time>
            </p>
            <p>
              Source references:{" "}
              {selected.sourceIds.length ? selected.sourceIds.join(", ") : "not available"}
            </p>
            <ul>
              {selected.explanation.caveats.map((caveat) => (
                <li key={caveat}>{caveat}</li>
              ))}
            </ul>
          </footer>
        </section>
      ) : null}
    </section>
  );
}
