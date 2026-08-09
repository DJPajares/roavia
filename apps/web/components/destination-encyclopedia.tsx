"use client";

import type { DestinationDetailResponse } from "@roavia/contracts";
import { ExperienceState } from "@roavia/ui";
import Link from "next/link";
import { useEffect, useState } from "react";

import { roaviaApi } from "../lib/api";
import { BestTimeCalendar } from "./best-time-calendar";

type State = "loading" | "offline" | "error" | "ready";

function titleFor(type: string) {
  return type.replace(/[._-]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function values(data: Record<string, unknown>) {
  return Object.entries(data).flatMap(([label, value]) =>
    typeof value === "string" || typeof value === "number" ? [[label, String(value)] as const] : [],
  );
}

export function DestinationEncyclopedia({ placeId }: { placeId: string }) {
  const [state, setState] = useState<State>("loading");
  const [detail, setDetail] = useState<DestinationDetailResponse["data"] | null>(null);

  useEffect(() => {
    if (!navigator.onLine) {
      setState("offline");
      return;
    }
    void roaviaApi
      .getDestination(placeId)
      .then((response) => {
        setDetail(response.data);
        setState("ready");
        return undefined;
      })
      .catch(() => setState("error"));
  }, [placeId]);

  if (state === "loading")
    return (
      <ExperienceState
        detail="Loading curated destination guidance and its sources."
        state="loading"
        title="Opening destination guide"
      />
    );
  if (state === "offline")
    return (
      <ExperienceState
        detail="Reconnect to view this guide. Roavia will never substitute unsourced destination information."
        state="offline"
        title="This guide needs a connection"
      />
    );
  if (state === "error" || !detail)
    return (
      <ExperienceState
        detail="The guide is unavailable right now. Try returning to search or try again later."
        state="error"
        title="We could not open this destination"
      />
    );

  const { place, content } = detail;
  return (
    <article className="destination-detail">
      <nav aria-label="Place hierarchy" className="destination-detail__crumbs">
        <Link href="/">Explore</Link>
        {place.hierarchy.map((item) => (
          <span key={item.id}> / {item.name}</span>
        ))}
      </nav>
      <header className="destination-detail__hero">
        <p className="eyebrow">{place.placeType}</p>
        <h1>{place.canonicalName}</h1>
        {Object.values(place.localizedNames).length ? (
          <p className="destination-detail__local">
            {Object.values(place.localizedNames).join(" · ")}
          </p>
        ) : null}
        <p>
          {place.summary ??
            "Roavia has a place in the curated launch catalogue, but its editorial guide is still being prepared."}
        </p>
        <div className="destination-detail__actions">
          <Link href="/plan">Plan a trip here</Link>
          <Link href="/trips">Add to a saved trip</Link>
        </div>
      </header>
      <aside className="destination-detail__facts" aria-label="Destination context">
        {place.countryCode ? <span>Country: {place.countryCode}</span> : null}
        {place.timezone ? <span>Timezone: {place.timezone}</span> : null}
      </aside>
      <BestTimeCalendar placeId={placeId} />
      {content.length === 0 ? (
        <ExperienceState
          detail="This place is in Roavia’s launch catalogue, but no approved practical guidance is available yet. We do not fill gaps with generated travel advice."
          state="empty"
          title="Guide still under review"
        />
      ) : (
        <div className="destination-detail__content">
          {content.map((section) => (
            <section className="destination-detail__section" key={section.id}>
              <div>
                <p className="eyebrow">
                  {section.freshness === "stale" ? "Update due" : "Curated guidance"}
                </p>
                <h2>{titleFor(section.type)}</h2>
              </div>
              {values(section.data).map(([label, value]) => (
                <p key={label}>
                  <strong>{titleFor(label)}:</strong> {value}
                </p>
              ))}
              <footer>
                <span>
                  {section.freshness === "stale" ? "May be out of date" : "Checked"}{" "}
                  {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
                    new Date(section.refreshedAt),
                  )}
                </span>
                {section.sources.map((source) => (
                  <span key={source.id}>
                    <a href={source.url} rel="noreferrer" target="_blank">
                      {source.kind.startsWith("official") ? "Official source: " : "Source: "}
                      {source.title ?? source.url}
                    </a>
                    {source.attribution ? ` — ${source.attribution}` : ""}
                    {source.license ? ` (${source.license})` : ""}
                    {source.licenseUrl ? (
                      <>
                        <span> </span>
                        <a href={source.licenseUrl} rel="noreferrer" target="_blank">
                          License
                        </a>
                      </>
                    ) : null}
                  </span>
                ))}
              </footer>
            </section>
          ))}
        </div>
      )}
    </article>
  );
}
