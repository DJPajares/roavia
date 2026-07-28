"use client";

import type { DestinationPlaceType, DestinationSearchResponse } from "@roavia/contracts";
import { Button, ExperienceState } from "@roavia/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import { roaviaApi } from "../lib/api";

const recentQueriesKey = "roavia:recent-destination-queries";
const placeTypeLabels: Record<DestinationPlaceType, string> = {
  city: "City",
  country: "Country",
  district: "District",
  poi: "Place",
  region: "Region",
  transit_hub: "Transit hub",
};
const filterOptions: Array<{ label: string; value: DestinationPlaceType }> = [
  { label: "Cities", value: "city" },
  { label: "Places", value: "poi" },
  { label: "Regions", value: "region" },
];

type SearchState = "empty" | "error" | "idle" | "loading" | "offline" | "ready";

function readRecentQueries(): string[] {
  try {
    const stored = window.localStorage.getItem(recentQueriesKey);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string").slice(0, 5)
      : [];
  } catch {
    return [];
  }
}

function saveRecentQuery(query: string): string[] {
  const next = [query, ...readRecentQueries().filter((value) => value !== query)].slice(0, 5);
  try {
    window.localStorage.setItem(recentQueriesKey, JSON.stringify(next));
  } catch {
    // Recent queries are a local convenience, never required for destination search.
  }
  return next;
}

export function DestinationSearch() {
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState<DestinationPlaceType[]>([]);
  const [country, setCountry] = useState<string | undefined>();
  const [recentQueries, setRecentQueries] = useState<string[]>([]);
  const [result, setResult] = useState<DestinationSearchResponse["data"] | null>(null);
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [isOnline, setIsOnline] = useState(true);
  const requestVersion = useRef(0);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    setRecentQueries(readRecentQueries());

    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const search = useCallback(
    async (page: number, append = false) => {
      const trimmedQuery = query.trim();
      if (!trimmedQuery) {
        setResult(null);
        setSearchState("idle");
        return;
      }
      if (!navigator.onLine) {
        setSearchState("offline");
        return;
      }

      const version = ++requestVersion.current;
      setSearchState("loading");
      try {
        const response = await roaviaApi.searchDestinations({
          query: trimmedQuery,
          page,
          limit: 8,
          types,
          ...(country ? { country } : {}),
        });
        if (version !== requestVersion.current) return;

        const data = response.data;
        setResult((current) =>
          append && current
            ? {
                ...data,
                results: [...current.results, ...data.results],
              }
            : data,
        );
        setSearchState(data.results.length === 0 && !append ? "empty" : "ready");
        setRecentQueries(saveRecentQuery(trimmedQuery));
      } catch {
        if (version !== requestVersion.current) return;
        setSearchState("error");
      }
    },
    [country, query, types],
  );

  useEffect(() => {
    if (!query.trim()) {
      setResult(null);
      setSearchState("idle");
      return;
    }
    if (!isOnline) {
      setSearchState("offline");
      return;
    }

    const timer = window.setTimeout(() => void search(1), 320);
    return () => window.clearTimeout(timer);
  }, [isOnline, query, search, types]);

  function toggleType(type: DestinationPlaceType) {
    setTypes((current) =>
      current.includes(type) ? current.filter((value) => value !== type) : [...current, type],
    );
  }

  return (
    <section aria-labelledby="destination-search-heading" className="destination-search">
      <div className="destination-search__intro">
        <p className="eyebrow">Explore with context</p>
        <h1 id="destination-search-heading">Find the place before you plan the path.</h1>
        <p>
          Search destinations by the names travelers use, then read each result in its geographic
          context.
        </p>
      </div>

      <div className="destination-search__panel">
        <label className="destination-search__field" htmlFor="destination-query">
          <span>Where would you like to go?</span>
          <input
            autoComplete="off"
            id="destination-query"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search a city, region, or landmark"
            type="search"
            value={query}
          />
        </label>
        <div aria-label="Destination filters" className="destination-search__filters">
          <span>Refine</span>
          {filterOptions.map((option) => (
            <button
              aria-pressed={types.includes(option.value)}
              className={types.includes(option.value) ? "is-selected" : undefined}
              key={option.value}
              onClick={() => toggleType(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
          <button
            aria-pressed={country === "SG"}
            className={country === "SG" ? "is-selected" : undefined}
            onClick={() => setCountry((current) => (current === "SG" ? undefined : "SG"))}
            type="button"
          >
            Singapore
          </button>
        </div>
      </div>

      {searchState === "idle" ? (
        <div className="destination-search__recent">
          <p>
            Begin with a destination. Roavia keeps only your recent search terms on this device.
          </p>
          {recentQueries.length > 0 ? (
            <div
              aria-label="Recent destination searches"
              className="destination-search__recent-list"
            >
              {recentQueries.map((recentQuery) => (
                <button key={recentQuery} onClick={() => setQuery(recentQuery)} type="button">
                  {recentQuery}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {searchState === "loading" && !result ? (
        <ExperienceState
          className="destination-search__state"
          detail="Checking Roavia’s destination catalogue."
          state="loading"
          title="Finding considered matches"
        />
      ) : null}
      {searchState === "offline" ? (
        <ExperienceState
          className="destination-search__state"
          detail="Reconnect to search the destination catalogue. Your recent searches remain on this device."
          state="offline"
          title="Destination search needs a connection"
        />
      ) : null}
      {searchState === "error" ? (
        <ExperienceState
          action={
            <Button onClick={() => void search(1)} tone="quiet">
              Try again
            </Button>
          }
          className="destination-search__state"
          detail="The catalogue is not available right now. Nothing about your trip has changed."
          state="error"
          title="We could not search destinations"
        />
      ) : null}
      {searchState === "empty" ? (
        <ExperienceState
          className="destination-search__state"
          detail="Try another spelling, a nearby region, or remove a filter to widen the search."
          state="empty"
          title="No destinations matched that search"
        />
      ) : null}

      {result && result.results.length > 0 ? (
        <div aria-live="polite" className="destination-search__results">
          <div className="destination-search__results-heading">
            <p>
              {result.pagination.total} considered match{result.pagination.total === 1 ? "" : "es"}
            </p>
            {searchState === "loading" ? <span>Updating…</span> : null}
          </div>
          <ol>
            {result.results.map((place) => (
              <li key={place.id}>
                <article className="destination-card">
                  <div>
                    <p className="destination-card__type">{placeTypeLabels[place.placeType]}</p>
                    <h2>{place.canonicalName}</h2>
                    {Object.values(place.localizedNames).length > 0 ? (
                      <p className="destination-card__local-name">
                        {Object.values(place.localizedNames).join(" · ")}
                      </p>
                    ) : null}
                    <p className="destination-card__hierarchy">
                      {[...place.hierarchy.map((item) => item.name), place.countryCode]
                        .filter(Boolean)
                        .join(" / ")}
                    </p>
                  </div>
                  <span aria-hidden="true">↗</span>
                </article>
              </li>
            ))}
          </ol>
          {result.pagination.nextPage ? (
            <Button onClick={() => void search(result.pagination.nextPage!, true)} tone="quiet">
              Show more destinations
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
