"use client";

import { ApiClientError, createRoaviaApiClient } from "@roavia/api-client";
import {
  itineraryItemSourceSnapshotSchema,
  itineraryRouteSnapshotSchema,
  type ItineraryCoordinates,
  type ItineraryItemSourceSnapshot,
  type ItineraryRouteSnapshot,
  type TripDay,
  type TripDetail,
  type TripItem,
} from "@roavia/contracts";
import { Button, ExperienceState, TrustNotice } from "@roavia/ui";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createClient } from "../lib/supabase/client";
import { ItineraryItemEditor, type ItemDraft, type ItemEditorMode } from "./itinerary-item-editor";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

type LoadState = "error" | "loading" | "permission" | "ready";
type MobileView = "plan" | "route";
type EditorState = { item: TripItem | null; mode: ItemEditorMode } | null;

interface PresentedItem {
  item: TripItem;
  route: ItineraryRouteSnapshot | null;
  snapshot: ItineraryItemSourceSnapshot;
}

interface PositionedItem extends PresentedItem {
  position: { left: number; top: number };
}

interface CoordinateBounds {
  latitudeRange: number;
  longitudeRange: number;
  minimumLatitude: number;
  minimumLongitude: number;
}

const itemTypeLabels: Record<TripItem["itemType"], string> = {
  activity: "Planned activity",
  food: "Meal stop",
  lodging: "Stay",
  note: "Trip note",
  transport: "Travel segment",
};

function sortedDays(trip: TripDetail) {
  return trip.days.toSorted(
    (left, right) =>
      left.orderIndex - right.orderIndex || left.localDate.localeCompare(right.localDate),
  );
}

function sortedItems(day: TripDay) {
  return day.items.toSorted(
    (left, right) =>
      left.orderIndex - right.orderIndex ||
      (left.startTime ?? "99:99").localeCompare(right.startTime ?? "99:99"),
  );
}

function snapshotFor(item: TripItem): ItineraryItemSourceSnapshot {
  const result = itineraryItemSourceSnapshotSchema.safeParse(item.sourceSnapshot);
  return result.success ? result.data : {};
}

function routeFor(item: TripItem): ItineraryRouteSnapshot | null {
  const nestedRoute = item.transport.route;
  const result = itineraryRouteSnapshotSchema.safeParse(nestedRoute ?? item.transport);
  return result.success ? result.data : null;
}

function presentItems(day: TripDay): PresentedItem[] {
  return sortedItems(day).map((item) => ({
    item,
    route: routeFor(item),
    snapshot: snapshotFor(item),
  }));
}

function formatDate(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en", { ...options, timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00.000Z`),
  );
}

function formatTime(time: string | null) {
  if (!time) return "Time flexible";
  const [hours = "0", minutes = "00"] = time.split(":");
  const date = new Date(2000, 0, 1, Number(hours), Number(minutes));
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(date);
}

function formatDuration(minutes: number | null) {
  if (minutes === null) return "Duration not estimated";
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (hours === 0) return `${remaining} min`;
  return remaining === 0 ? `${hours} hr` : `${hours} hr ${remaining} min`;
}

function formatRouteDuration(seconds: number) {
  return formatDuration(Math.ceil(seconds / 60));
}

function formatDistance(meters: number) {
  if (meters < 1_000) return `${Math.round(meters)} m`;
  return `${(meters / 1_000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

function formatMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en", { currency, style: "currency" }).format(amountMinor / 100);
}

function formatRetrievedAt(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function itemName(presented: PresentedItem) {
  if (presented.snapshot.place?.name) return presented.snapshot.place.name;
  return itemTypeLabels[presented.item.itemType];
}

function minutesSinceMidnight(value: string | null) {
  if (!value) return null;
  const [hours = "0", minutes = "0"] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
}

function warningFor(items: PresentedItem[], index: number) {
  if (index === 0) return null;
  const previous = items[index - 1];
  const current = items[index];
  if (!previous || !current) return null;
  const previousEnd = minutesSinceMidnight(previous.item.endTime);
  const currentStart = minutesSinceMidnight(current.item.startTime);
  if (previousEnd === null || currentStart === null) return null;
  if (currentStart < previousEnd)
    return "Schedule conflict: this starts before the previous item ends.";
  if (
    current.route?.availability === "available" &&
    current.route.durationSeconds > (currentStart - previousEnd) * 60
  ) {
    return "Travel-time conflict: the route estimate is longer than the available gap.";
  }
  return null;
}

function duplicateWarningFor(items: PresentedItem[], index: number) {
  const current = items[index];
  if (!current) return null;
  const currentName = current.snapshot.place?.name.trim().toLocaleLowerCase();
  const duplicate = items.some(({ item, snapshot }, otherIndex) => {
    if (otherIndex === index) return false;
    if (current.item.placeId && item.placeId === current.item.placeId) return true;
    return Boolean(currentName && snapshot.place?.name.trim().toLocaleLowerCase() === currentName);
  });
  return duplicate
    ? "Possible duplicate: another item on this day uses the same saved place or name."
    : null;
}

function metadataString(value: Record<string, unknown>, key: string) {
  return typeof value[key] === "string" ? value[key] : null;
}

function safeHttpUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

function errorDetail(error: unknown) {
  if (error instanceof ApiClientError && error.status === 401) {
    return "Your session has expired. Sign in again to view this itinerary.";
  }
  if (error instanceof ApiClientError && error.status === 403) {
    return "This itinerary is not available to your account.";
  }
  if (error instanceof ApiClientError && error.status === 404) {
    return "This itinerary may have moved or been removed.";
  }
  return error instanceof Error
    ? error.message
    : "The itinerary could not be loaded. Your saved trip has not been changed.";
}

function dayCosts(items: PresentedItem[]) {
  const totals = new Map<string, number>();
  for (const { item } of items) {
    if (!item.estimatedCost) continue;
    totals.set(
      item.estimatedCost.currency,
      (totals.get(item.estimatedCost.currency) ?? 0) + item.estimatedCost.amountMinor,
    );
  }
  return [...totals.entries()].map(([currency, amount]) => formatMoney(amount, currency));
}

function withDayItems(
  trip: TripDetail,
  dayId: string,
  items: TripItem[],
  revision = trip.revision,
) {
  return {
    ...trip,
    revision,
    days: trip.days.map((day) => (day.id === dayId ? { ...day, items } : day)),
  };
}

function orderedWithMove(items: TripItem[], itemId: string, targetIndex: number) {
  const ordered = items.toSorted((left, right) => left.orderIndex - right.orderIndex);
  const sourceIndex = ordered.findIndex(({ id }) => id === itemId);
  if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= ordered.length) return ordered;
  const [moved] = ordered.splice(sourceIndex, 1);
  if (!moved) return ordered;
  ordered.splice(targetIndex, 0, moved);
  return ordered.map((item, index) => ({ ...item, orderIndex: index }));
}

function DayTabs({
  days,
  onSelect,
  selectedDayId,
}: Readonly<{
  days: TripDay[];
  onSelect: (dayId: string) => void;
  selectedDayId: string;
}>) {
  function selectFromKeyboard(index: number, event: React.KeyboardEvent<HTMLButtonElement>) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % days.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + days.length) % days.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = days.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextDay = days[nextIndex];
    if (!nextDay) return;
    onSelect(nextDay.id);
    document.querySelector<HTMLButtonElement>(`[data-day-tab="${nextDay.id}"]`)?.focus();
  }

  return (
    <div aria-label="Itinerary days" className="itinerary-days" role="tablist">
      {days.map((day, index) => {
        const selected = day.id === selectedDayId;
        return (
          <button
            aria-controls="itinerary-day-panel"
            aria-selected={selected}
            className={selected ? "is-selected" : undefined}
            data-day-tab={day.id}
            key={day.id}
            onClick={() => onSelect(day.id)}
            onKeyDown={(event) => selectFromKeyboard(index, event)}
            role="tab"
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            <span>Day {index + 1}</span>
            {formatDate(day.localDate, { day: "numeric", month: "short", weekday: "short" })}
          </button>
        );
      })}
    </div>
  );
}

function ItemCard({
  busy,
  index,
  items,
  onDragStart,
  onDrop,
  onDuplicate,
  onEdit,
  onLocate,
  onMove,
  onRemove,
  onReplace,
  selected,
}: Readonly<{
  busy: boolean;
  index: number;
  items: PresentedItem[];
  onDragStart: (itemId: string) => void;
  onDrop: (targetIndex: number, draggedItemId: string) => void;
  onDuplicate: (item: TripItem) => void;
  onEdit: (item: TripItem) => void;
  onLocate: (itemId: string) => void;
  onMove: (itemId: string, targetIndex: number) => void;
  onRemove: (item: TripItem) => void;
  onReplace: (item: TripItem) => void;
  selected: boolean;
}>) {
  const presented = items[index];
  if (!presented) return null;
  const { item, route, snapshot } = presented;
  const warning = warningFor(items, index);
  const duplicateWarning = duplicateWarningFor(items, index);
  const name = itemName(presented);
  const source = snapshot.source;
  const hasMapPoint = Boolean(snapshot.place?.coordinates);
  const transportMode = metadataString(item.transport, "mode");
  const transportDetails = metadataString(item.transport, "details");
  const bookingReference = metadataString(item.booking, "reference");
  const bookingUrl = safeHttpUrl(metadataString(item.booking, "url"));

  return (
    <article
      aria-current={selected ? "true" : undefined}
      className={`itinerary-item${selected ? " is-selected" : ""}`}
      id={`itinerary-item-${item.id}`}
    >
      <button
        aria-label={`Drag ${name} to reorder; current position ${index + 1}`}
        className="itinerary-item__sequence"
        disabled={busy}
        draggable={!busy}
        onDragOver={(event) => event.preventDefault()}
        onDragStart={(event) => {
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", item.id);
          }
          onDragStart(item.id);
        }}
        onDrop={(event) => {
          event.preventDefault();
          onDrop(index, event.dataTransfer?.getData("text/plain") ?? "");
        }}
        onPointerDown={() => onDragStart(item.id)}
        onPointerUp={() => onDrop(index, "")}
        type="button"
      >
        {index + 1}
      </button>
      <div className="itinerary-item__body">
        <div className="itinerary-item__heading">
          <div>
            <p className="itinerary-item__type">{item.itemType}</p>
            <h3>{name}</h3>
            {snapshot.place?.address ? <p>{snapshot.place.address}</p> : null}
          </div>
          <span className="itinerary-item__time">{formatTime(item.startTime)}</span>
        </div>

        <dl className="itinerary-item__facts">
          <div>
            <dt>Duration</dt>
            <dd>{formatDuration(item.durationMinutes)}</dd>
          </div>
          <div>
            <dt>Cost</dt>
            <dd>
              {item.estimatedCost
                ? formatMoney(item.estimatedCost.amountMinor, item.estimatedCost.currency)
                : "Not estimated"}
            </dd>
          </div>
          <div>
            <dt>Confidence</dt>
            <dd>
              {item.confidence === null ? "Unavailable" : `${Math.round(item.confidence * 100)}%`}
            </dd>
          </div>
        </dl>

        {route?.availability === "available" ? (
          <section aria-label={`Route to ${name}`} className="itinerary-item__route">
            <strong>
              {route.mode} · {formatDistance(route.distanceMeters)} ·{" "}
              {formatRouteDuration(route.durationSeconds)}
            </strong>
            <p>{route.confidence.explanation}</p>
            <span className={route.freshness === "stale" ? "is-stale" : undefined}>
              Route estimate {route.freshness} · retrieved {formatRetrievedAt(route.retrievedAt)}
            </span>
          </section>
        ) : null}
        {route && route.availability !== "available" ? (
          <section aria-label={`Route to ${name}`} className="itinerary-item__route is-unavailable">
            <strong>
              {route.availability === "provider_unavailable"
                ? "Route provider unavailable"
                : "Route unavailable"}
            </strong>
            <p>{route.reason}</p>
          </section>
        ) : null}
        {item.itemType === "transport" && !route ? (
          <p className="itinerary-item__missing">Route details have not been added yet.</p>
        ) : null}
        {warning ? <output className="itinerary-item__warning">{warning}</output> : null}
        {duplicateWarning ? (
          <output className="itinerary-item__warning">{duplicateWarning}</output>
        ) : null}
        {item.notes ? <p className="itinerary-item__notes">{item.notes}</p> : null}
        {transportDetails || bookingReference || bookingUrl ? (
          <dl className="itinerary-item__metadata">
            {transportDetails ? (
              <div>
                <dt>Transport{transportMode ? ` · ${transportMode}` : ""}</dt>
                <dd>{transportDetails}</dd>
              </div>
            ) : null}
            {bookingReference ? (
              <div>
                <dt>Booking reference</dt>
                <dd>{bookingReference}</dd>
              </div>
            ) : null}
            {bookingUrl ? (
              <div>
                <dt>Booking</dt>
                <dd>
                  <a href={bookingUrl}>Open saved booking link</a>
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        <div className="itinerary-item__footer">
          {source ? (
            <p>
              Source: {source.url ? <a href={source.url}>{source.label}</a> : source.label} ·{" "}
              <span className={source.freshness === "stale" ? "is-stale" : undefined}>
                {source.freshness}, retrieved {formatRetrievedAt(source.retrievedAt)}
              </span>
            </p>
          ) : (
            <p>Source details unavailable</p>
          )}
          {hasMapPoint ? (
            <Button onClick={() => onLocate(item.id)} tone="quiet">
              Locate on route
            </Button>
          ) : null}
        </div>
        <div aria-label={`Actions for ${name}`} className="itinerary-item__actions">
          <span aria-hidden="true" className="itinerary-item__drag-hint">
            Drag to reorder
          </span>
          <button
            aria-label={`Move ${name} earlier`}
            disabled={busy || index === 0}
            onClick={() => onMove(item.id, index - 1)}
            type="button"
          >
            ↑ Earlier
          </button>
          <button
            aria-label={`Move ${name} later`}
            disabled={busy || index === items.length - 1}
            onClick={() => onMove(item.id, index + 1)}
            type="button"
          >
            ↓ Later
          </button>
          <button disabled={busy} onClick={() => onEdit(item)} type="button">
            Edit
          </button>
          <button disabled={busy} onClick={() => onReplace(item)} type="button">
            Replace
          </button>
          <button disabled={busy} onClick={() => onDuplicate(item)} type="button">
            Duplicate
          </button>
          <button
            className="is-danger"
            disabled={busy}
            onClick={() => onRemove(item)}
            type="button"
          >
            Remove
          </button>
        </div>
      </div>
    </article>
  );
}

function allCoordinates(items: PresentedItem[]) {
  const values: ItineraryCoordinates[] = [];
  for (const { route, snapshot } of items) {
    if (snapshot.place?.coordinates) values.push(snapshot.place.coordinates);
    if (route?.availability === "available" && route.geometry) {
      values.push(...route.geometry.coordinates);
    }
  }
  return values;
}

function coordinateBounds(coordinates: ItineraryCoordinates[]): CoordinateBounds {
  let minimumLatitude = Number.POSITIVE_INFINITY;
  let maximumLatitude = Number.NEGATIVE_INFINITY;
  let minimumLongitude = Number.POSITIVE_INFINITY;
  let maximumLongitude = Number.NEGATIVE_INFINITY;
  for (const { latitude, longitude } of coordinates) {
    minimumLatitude = Math.min(minimumLatitude, latitude);
    maximumLatitude = Math.max(maximumLatitude, latitude);
    minimumLongitude = Math.min(minimumLongitude, longitude);
    maximumLongitude = Math.max(maximumLongitude, longitude);
  }
  return {
    latitudeRange: Math.max(maximumLatitude - minimumLatitude, 0.01),
    longitudeRange: Math.max(maximumLongitude - minimumLongitude, 0.01),
    minimumLatitude,
    minimumLongitude,
  };
}

function coordinatePosition(coordinate: ItineraryCoordinates, bounds: CoordinateBounds) {
  return {
    left: 8 + ((coordinate.longitude - bounds.minimumLongitude) / bounds.longitudeRange) * 84,
    top: 92 - ((coordinate.latitude - bounds.minimumLatitude) / bounds.latitudeRange) * 84,
  };
}

function MapContext({
  items,
  onSelect,
  selectedItemId,
}: Readonly<{
  items: PresentedItem[];
  onSelect: (itemId: string) => void;
  selectedItemId: string | null;
}>) {
  const coordinates = allCoordinates(items);
  const bounds = coordinateBounds(coordinates);
  const positioned = items.flatMap<PositionedItem>((presented) => {
    const coordinate = presented.snapshot.place?.coordinates;
    return coordinate ? [{ ...presented, position: coordinatePosition(coordinate, bounds) }] : [];
  });
  const routeLines = items.flatMap(({ route }) => {
    if (route?.availability !== "available" || !route.geometry) return [];
    return [
      route.geometry.coordinates
        .map((coordinate) => coordinatePosition(coordinate, bounds))
        .map(({ left, top }) => `${left},${top}`)
        .join(" "),
    ];
  });
  const fallbackLine = positioned
    .map(({ position }) => `${position.left},${position.top}`)
    .join(" ");
  const providerUnavailable = items.some(
    ({ route }) => route?.availability === "provider_unavailable",
  );

  return (
    <aside aria-labelledby="map-context-heading" className="map-context">
      <div className="map-context__heading">
        <div>
          <p className="eyebrow">Spatial overview</p>
          <h2 id="map-context-heading">Map context</h2>
        </div>
        <span>{positioned.length} mapped stops</span>
      </div>
      {positioned.length > 0 ? (
        <>
          <div className="map-context__canvas">
            <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 100 100">
              <path
                className="map-context__river"
                d="M-5 72 C 18 50, 25 85, 49 58 S 76 28, 106 42"
              />
              {(routeLines.length > 0 ? routeLines : [fallbackLine]).map((points, index) => (
                <polyline
                  className="map-context__route-line"
                  key={points || index}
                  points={points}
                />
              ))}
            </svg>
            {positioned.map(({ item, position, ...presented }, index) => (
              <button
                aria-label={`Select ${itemName({ ...presented, item })} in the itinerary`}
                aria-pressed={selectedItemId === item.id}
                className={selectedItemId === item.id ? "is-selected" : undefined}
                key={item.id}
                onClick={() => onSelect(item.id)}
                style={{ left: `${position.left}%`, top: `${position.top}%` }}
                type="button"
              >
                {index + 1}
              </button>
            ))}
          </div>
          <div className="map-context__alternative">
            <h3>Route stops</h3>
            <ol>
              {positioned.map((presented) => (
                <li key={presented.item.id}>
                  <button
                    aria-current={selectedItemId === presented.item.id ? "location" : undefined}
                    onClick={() => onSelect(presented.item.id)}
                    type="button"
                  >
                    {itemName(presented)}
                  </button>
                  {presented.snapshot.place?.address ? (
                    <span>{presented.snapshot.place.address}</span>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        </>
      ) : (
        <ExperienceState
          detail="The itinerary remains available as a text timeline while location coordinates are missing."
          state="empty"
          title="No mapped stops yet"
        />
      )}
      {providerUnavailable ? (
        <output className="map-context__provider-state">
          Live route context is unavailable. Saved places and itinerary details remain usable.
        </output>
      ) : null}
      <p className="map-context__caption">
        This spatial view uses normalized saved coordinates. The route-stop list provides the same
        selection controls without the map.
      </p>
    </aside>
  );
}

export function ItineraryWorkspace({
  email,
  tripId,
}: Readonly<{ email: string | undefined; tripId: string }>) {
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [message, setMessage] = useState("");
  const [offline, setOffline] = useState(false);
  const [selectedDayId, setSelectedDayId] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<MobileView>("plan");
  const [editor, setEditor] = useState<EditorState>(null);
  const [removeItem, setRemoveItem] = useState<TripItem | null>(null);
  const [mutationMessage, setMutationMessage] = useState("");
  const [mutationBusy, setMutationBusy] = useState(false);
  const draggedItemId = useRef<string | null>(null);
  const tripRef = useRef<TripDetail | null>(null);
  const api = useMemo(
    () =>
      createRoaviaApiClient({
        accessToken: async () =>
          (await createClient().auth.getSession()).data.session?.access_token ?? null,
        baseUrl: apiBaseUrl,
      }),
    [],
  );

  const loadTrip = useCallback(async () => {
    if (!tripRef.current) setState("loading");
    setMessage("");
    try {
      const response = await api.getTrip(tripId);
      const days = sortedDays(response.data);
      tripRef.current = response.data;
      setTrip(response.data);
      setSelectedDayId((current) =>
        days.some(({ id }) => id === current) ? current : (days[0]?.id ?? ""),
      );
      setState("ready");
    } catch (error) {
      const detail = errorDetail(error);
      if (tripRef.current) {
        setMessage(detail);
        setState("ready");
      } else {
        setMessage(detail);
        setState(
          error instanceof ApiClientError && (error.status === 401 || error.status === 403)
            ? "permission"
            : "error",
        );
      }
    }
  }, [api, tripId]);

  useEffect(() => {
    tripRef.current = trip;
  }, [trip]);

  useEffect(() => {
    void loadTrip();
  }, [loadTrip]);

  useEffect(() => {
    const goOnline = () => setOffline(false);
    const goOffline = () => setOffline(true);
    setOffline(!navigator.onLine);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (state === "loading" && !trip) {
    return (
      <ExperienceState
        detail="Coordinating your itinerary days, saved context, and route estimates."
        state="loading"
        title="Loading itinerary"
      />
    );
  }

  if ((state === "error" || state === "permission") && !trip) {
    return (
      <ExperienceState
        action={
          state === "permission" ? (
            <Link
              className="roavia-button roavia-button--quiet"
              href={`/auth/sign-in?next=${encodeURIComponent(`/trips/${tripId}`)}`}
            >
              Sign in again
            </Link>
          ) : (
            <Button onClick={() => void loadTrip()} tone="quiet">
              Try again
            </Button>
          )
        }
        detail={message}
        state={state === "permission" ? "permission" : "error"}
        title={state === "permission" ? "Itinerary access needed" : "Itinerary unavailable"}
      />
    );
  }

  if (!trip) return null;
  const days = sortedDays(trip);
  if (days.length === 0) {
    return (
      <section className="itinerary-workspace">
        <Link className="itinerary-workspace__back" href="/trips">
          ← All trips
        </Link>
        <ExperienceState
          action={
            <Link className="roavia-button roavia-button--accent" href={`/plan?tripId=${trip.id}`}>
              Continue planning
            </Link>
          }
          detail="Continue the guided plan to add the first day. Nothing has been changed here."
          state="empty"
          title="This itinerary has no days yet"
        />
      </section>
    );
  }

  const selectedDay = days.find(({ id }) => id === selectedDayId) ?? days[0];
  if (!selectedDay) return null;
  const items = presentItems(selectedDay);
  const costs = dayCosts(items);
  const stale = items.some(
    ({ route, snapshot }) =>
      snapshot.source?.freshness === "stale" ||
      (route?.availability === "available" && route.freshness === "stale"),
  );
  const partial = items.some(
    ({ item, route, snapshot }) =>
      (item.itemType !== "note" && !snapshot.place) ||
      item.confidence === null ||
      (item.itemType === "transport" && !route),
  );

  function selectItem(itemId: string) {
    setSelectedItemId(itemId);
    setMobileView("route");
  }

  function saveTrip(nextTrip: TripDetail) {
    tripRef.current = nextTrip;
    setTrip(nextTrip);
  }

  async function restoreAfterFailure(before: TripDetail, error: unknown) {
    saveTrip(before);
    if (error instanceof ApiClientError && error.status === 409) {
      try {
        const response = await api.getTrip(tripId);
        saveTrip(response.data);
        setMutationMessage(
          "This trip changed in another session. Your attempted change was not applied, and the latest saved itinerary has been reloaded.",
        );
      } catch (reloadError) {
        setMutationMessage(
          `This trip changed in another session. Your attempted change was not applied. Reload failed: ${errorDetail(reloadError)}`,
        );
      }
      return;
    }
    setMutationMessage(
      `Save failed. The previous itinerary was restored and your editor remains open. ${errorDetail(error)}`,
    );
  }

  async function submitEditor(draft: ItemDraft) {
    if (!editor || mutationBusy) return;
    if ((editor.mode === "edit" || editor.mode === "replace") && !editor.item) return;
    const before = tripRef.current;
    if (!before) return;
    const targetDayId = editor.item?.itineraryDayId ?? selectedDay.id;
    const targetDay = before.days.find(({ id }) => id === targetDayId);
    if (!targetDay) return;
    setMutationBusy(true);
    setMutationMessage("");
    if (editor.mode === "add" || editor.mode === "duplicate") {
      const orderIndex =
        editor.mode === "duplicate" && editor.item
          ? editor.item.orderIndex + 1
          : targetDay.items.length;
      const optimisticId = crypto.randomUUID();
      const optimisticItem: TripItem = {
        ...draft,
        id: optimisticId,
        itineraryDayId: targetDayId,
        orderIndex,
      };
      const optimisticItems = orderedWithMove(
        [...targetDay.items, { ...optimisticItem, orderIndex: targetDay.items.length }],
        optimisticId,
        Math.min(orderIndex, targetDay.items.length),
      );
      const optimisticTrip = withDayItems(before, targetDayId, optimisticItems);
      saveTrip(optimisticTrip);
      try {
        const response = await api.createTripItem(tripId, {
          ...draft,
          expectedTripRevision: before.revision,
          itineraryDayId: targetDayId,
          orderIndex,
        });
        saveTrip(
          withDayItems(
            optimisticTrip,
            targetDayId,
            optimisticItems.map((item) => (item.id === optimisticId ? response.data.item : item)),
            response.data.tripRevision,
          ),
        );
        setEditor(null);
        setMutationMessage(
          editor.mode === "duplicate" ? "Item duplicated and saved." : "Item added and saved.",
        );
      } catch (error) {
        await restoreAfterFailure(before, error);
      } finally {
        setMutationBusy(false);
      }
      return;
    }

    if (!editor.item) return;
    const optimisticItem = { ...editor.item, ...draft };
    const optimisticTrip = withDayItems(
      before,
      targetDayId,
      targetDay.items.map((item) => (item.id === editor.item?.id ? optimisticItem : item)),
    );
    saveTrip(optimisticTrip);
    try {
      const response = await api.updateTripItem(tripId, editor.item.id, {
        ...draft,
        expectedTripRevision: before.revision,
      });
      saveTrip(
        withDayItems(
          optimisticTrip,
          targetDayId,
          optimisticTrip.days
            .find(({ id }) => id === targetDayId)!
            .items.map((item) => (item.id === response.data.item.id ? response.data.item : item)),
          response.data.tripRevision,
        ),
      );
      setEditor(null);
      setMutationMessage(editor.mode === "replace" ? "Item replaced and saved." : "Changes saved.");
    } catch (error) {
      await restoreAfterFailure(before, error);
    } finally {
      setMutationBusy(false);
    }
  }

  async function confirmRemove() {
    const item = removeItem;
    const before = tripRef.current;
    if (!item || !before || mutationBusy) return;
    const targetDay = before.days.find(({ id }) => id === item.itineraryDayId);
    if (!targetDay) return;
    setMutationBusy(true);
    setMutationMessage("");
    const optimisticTrip = withDayItems(
      before,
      item.itineraryDayId,
      targetDay.items
        .filter(({ id }) => id !== item.id)
        .map((value, index) => ({ ...value, orderIndex: index })),
    );
    saveTrip(optimisticTrip);
    try {
      const response = await api.deleteTripItem(tripId, item.id, {
        expectedTripRevision: before.revision,
      });
      saveTrip({ ...optimisticTrip, revision: response.data.tripRevision });
      setRemoveItem(null);
      setMutationMessage("Item removed and saved.");
    } catch (error) {
      await restoreAfterFailure(before, error);
    } finally {
      setMutationBusy(false);
    }
  }

  async function moveItem(itemId: string, targetIndex: number) {
    const before = tripRef.current;
    if (!before || mutationBusy) return;
    const day = before.days.find(({ id }) => id === selectedDay.id);
    const item = day?.items.find(({ id }) => id === itemId);
    if (!day || !item || item.orderIndex === targetIndex) return;
    const movedItems = orderedWithMove(day.items, itemId, targetIndex);
    const optimisticTrip = withDayItems(before, day.id, movedItems);
    setMutationBusy(true);
    setMutationMessage("");
    saveTrip(optimisticTrip);
    try {
      const response = await api.updateTripItem(tripId, itemId, {
        expectedTripRevision: before.revision,
        orderIndex: targetIndex,
      });
      saveTrip(
        withDayItems(
          optimisticTrip,
          day.id,
          movedItems.map((value) =>
            value.id === response.data.item.id
              ? { ...response.data.item, orderIndex: value.orderIndex }
              : value,
          ),
          response.data.tripRevision,
        ),
      );
      setMutationMessage("Item order saved.");
    } catch (error) {
      await restoreAfterFailure(before, error);
    } finally {
      setMutationBusy(false);
      draggedItemId.current = null;
    }
  }

  return (
    <section aria-labelledby="itinerary-heading" className="itinerary-workspace">
      <Link className="itinerary-workspace__back" href="/trips">
        ← All trips
      </Link>
      <header className="itinerary-workspace__header">
        <div>
          <p className="eyebrow">Itinerary workspace</p>
          <h1 id="itinerary-heading">{trip.title}</h1>
          <p>
            {formatDate(trip.startDate, { dateStyle: "medium" })} –{" "}
            {formatDate(trip.endDate, { dateStyle: "medium" })} · {days.length} days
          </p>
          {email ? <span>Private workspace for {email}</span> : null}
        </div>
        <Button disabled={offline} onClick={() => void loadTrip()} tone="quiet">
          Refresh itinerary
        </Button>
      </header>

      {offline ? (
        <output className="itinerary-workspace__notice is-offline">
          Offline: showing the itinerary already loaded on this device. Live route context will not
          refresh.
        </output>
      ) : null}
      {message ? (
        <output className="itinerary-workspace__notice">
          Refresh failed: {message} The loaded itinerary is unchanged.
        </output>
      ) : null}
      {mutationMessage ? (
        <output className="itinerary-workspace__notice">{mutationMessage}</output>
      ) : null}
      {stale ? (
        <output className="itinerary-workspace__notice is-stale">
          Some route or place details are stale. Review their retrieval times before relying on
          them.
        </output>
      ) : null}
      {partial ? (
        <output className="itinerary-workspace__notice">
          Partial context: some items are missing a place, source, confidence, or normalized route
          estimate.
        </output>
      ) : null}

      <DayTabs days={days} onSelect={setSelectedDayId} selectedDayId={selectedDay.id} />

      <div aria-label="Workspace view" className="itinerary-mobile-view" role="tablist">
        <button
          aria-controls="itinerary-day-panel"
          aria-selected={mobileView === "plan"}
          onClick={() => setMobileView("plan")}
          role="tab"
          type="button"
        >
          Day plan
        </button>
        <button
          aria-controls="itinerary-route-panel"
          aria-selected={mobileView === "route"}
          onClick={() => setMobileView("route")}
          role="tab"
          type="button"
        >
          Route context
        </button>
      </div>

      <div className={`itinerary-workspace__layout show-${mobileView}`}>
        <section
          aria-labelledby="selected-day-heading"
          className="itinerary-timeline"
          id="itinerary-day-panel"
          role="tabpanel"
        >
          <div className="itinerary-timeline__heading">
            <div>
              <p>{formatDate(selectedDay.localDate, { dateStyle: "full" })}</p>
              <h2 id="selected-day-heading">
                {selectedDay.title ?? `Day ${days.indexOf(selectedDay) + 1}`}
              </h2>
              {selectedDay.notes ? <span>{selectedDay.notes}</span> : null}
            </div>
            <div className="itinerary-timeline__total">
              <span>Day estimate</span>
              <strong>{costs.length > 0 ? costs.join(" + ") : "No costs yet"}</strong>
            </div>
            <button
              className="itinerary-timeline__add"
              disabled={mutationBusy || offline}
              onClick={() => setEditor({ item: null, mode: "add" })}
              type="button"
            >
              + Add item
            </button>
          </div>
          {items.length > 0 ? (
            <div className="itinerary-timeline__items">
              {items.map(({ item }, index) => (
                <ItemCard
                  busy={mutationBusy || offline}
                  index={index}
                  items={items}
                  key={item.id}
                  onDragStart={(itemId) => {
                    draggedItemId.current = itemId;
                  }}
                  onDrop={(targetIndex, transferredItemId) => {
                    const itemId = transferredItemId || draggedItemId.current;
                    if (itemId) void moveItem(itemId, targetIndex);
                  }}
                  onDuplicate={(value) => setEditor({ item: value, mode: "duplicate" })}
                  onEdit={(value) => setEditor({ item: value, mode: "edit" })}
                  onLocate={selectItem}
                  onMove={(itemId, targetIndex) => void moveItem(itemId, targetIndex)}
                  onRemove={setRemoveItem}
                  onReplace={(value) => setEditor({ item: value, mode: "replace" })}
                  selected={selectedItemId === item.id}
                />
              ))}
            </div>
          ) : (
            <ExperienceState
              detail="This day is saved, but no itinerary items have been added. Continue planning to shape it."
              state="empty"
              title="No plans for this day"
            />
          )}
        </section>

        <div className="itinerary-route-panel" id="itinerary-route-panel" role="tabpanel">
          <MapContext items={items} onSelect={setSelectedItemId} selectedItemId={selectedItemId} />
        </div>
      </div>

      <TrustNotice label="Planning boundary">
        This workspace does not silently change your itinerary. Route estimates and confidence are
        context for your decision, not confirmed bookings.
      </TrustNotice>
      {editor ? (
        <ItineraryItemEditor
          busy={mutationBusy}
          item={editor.item}
          key={`${editor.mode}-${editor.item?.id ?? selectedDay.id}`}
          mode={editor.mode}
          onCancel={() => setEditor(null)}
          onSubmit={submitEditor}
        />
      ) : null}
      {removeItem ? (
        <div className="itinerary-editor-backdrop">
          <section
            aria-labelledby="remove-itinerary-item-heading"
            aria-modal="true"
            className="itinerary-remove-dialog"
            role="alertdialog"
          >
            <p className="eyebrow">Confirm removal</p>
            <h2 id="remove-itinerary-item-heading">Remove this itinerary item?</h2>
            <p>
              This removes the saved item, including its notes, cost, transport, and booking
              metadata. If saving fails, the complete item will be restored.
            </p>
            <div className="itinerary-editor__actions">
              <button disabled={mutationBusy} onClick={() => setRemoveItem(null)} type="button">
                Keep item
              </button>
              <button
                className="is-danger"
                disabled={mutationBusy}
                onClick={() => void confirmRemove()}
                type="button"
              >
                {mutationBusy ? "Removing…" : "Remove item"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
