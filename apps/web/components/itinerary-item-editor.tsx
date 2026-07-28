"use client";

import type { TripItem, TripItemCreateInput } from "@roavia/contracts";
import { useId, useState } from "react";

export type ItemEditorMode = "add" | "duplicate" | "edit" | "replace";
export type ItemDraft = Omit<TripItemCreateInput, "expectedTripRevision" | "itineraryDayId">;

interface FormValues {
  address: string;
  bookingReference: string;
  bookingUrl: string;
  costAmount: string;
  currency: string;
  durationMinutes: string;
  endTime: string;
  itemType: TripItem["itemType"];
  notes: string;
  placeId: string;
  placeName: string;
  startTime: string;
  transportDetails: string;
  transportMode: string;
}

const modeCopy: Record<ItemEditorMode, { action: string; title: string }> = {
  add: { action: "Add item", title: "Add itinerary item" },
  duplicate: { action: "Create duplicate", title: "Duplicate itinerary item" },
  edit: { action: "Save changes", title: "Edit itinerary item" },
  replace: { action: "Replace item", title: "Replace itinerary item" },
};

function objectString(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : "";
}

function initialValues(item: TripItem | null): FormValues {
  const place =
    item?.sourceSnapshot.place && typeof item.sourceSnapshot.place === "object"
      ? (item.sourceSnapshot.place as Record<string, unknown>)
      : {};
  return {
    address: typeof place.address === "string" ? place.address : "",
    bookingReference: objectString(item?.booking, "reference"),
    bookingUrl: objectString(item?.booking, "url"),
    costAmount: item?.estimatedCost ? String(item.estimatedCost.amountMinor / 100) : "",
    currency: item?.estimatedCost?.currency ?? "USD",
    durationMinutes: item?.durationMinutes ? String(item.durationMinutes) : "",
    endTime: item?.endTime?.slice(0, 5) ?? "",
    itemType: item?.itemType ?? "activity",
    notes: item?.notes ?? "",
    placeId: item?.placeId ?? "",
    placeName: typeof place.name === "string" ? place.name : "",
    startTime: item?.startTime?.slice(0, 5) ?? "",
    transportDetails: objectString(item?.transport, "details"),
    transportMode: objectString(item?.transport, "mode"),
  };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validate(values: FormValues) {
  const errors: string[] = [];
  if (values.itemType !== "note" && !values.placeName.trim()) {
    errors.push("Add a place or item name.");
  }
  if (values.placeId && !isUuid(values.placeId)) errors.push("Place ID must be a valid UUID.");
  if (Boolean(values.startTime) !== Boolean(values.endTime)) {
    errors.push("Provide both a start and end time, or leave both flexible.");
  } else if (values.startTime && values.endTime && values.endTime <= values.startTime) {
    errors.push("End time must be after start time.");
  }
  if (values.durationMinutes && Number(values.durationMinutes) < 1) {
    errors.push("Duration must be at least one minute.");
  }
  if (values.costAmount && Number(values.costAmount) < 0) {
    errors.push("Cost cannot be negative.");
  }
  if (values.costAmount && !/^[A-Z]{3}$/.test(values.currency)) {
    errors.push("Currency must be a three-letter code such as USD.");
  }
  if (values.bookingUrl) {
    try {
      const url = new URL(values.bookingUrl);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    } catch {
      errors.push("Booking URL must be a valid HTTP or HTTPS address.");
    }
  }
  return errors;
}

function toDraft(values: FormValues, item: TripItem | null): ItemDraft {
  const placeName = values.placeName.trim();
  const address = values.address.trim();
  const sourceSnapshot = { ...item?.sourceSnapshot };
  const previousPlace =
    item?.sourceSnapshot.place && typeof item.sourceSnapshot.place === "object"
      ? (item.sourceSnapshot.place as Record<string, unknown>)
      : {};
  const placeChanged =
    placeName !== (typeof previousPlace.name === "string" ? previousPlace.name : "") ||
    address !== (typeof previousPlace.address === "string" ? previousPlace.address : "");
  if (placeName) {
    sourceSnapshot.place = {
      ...(item?.sourceSnapshot.place && typeof item.sourceSnapshot.place === "object"
        ? item.sourceSnapshot.place
        : {}),
      ...(address ? { address } : {}),
      name: placeName,
    };
  } else {
    delete sourceSnapshot.place;
  }
  if (
    placeChanged &&
    sourceSnapshot.source &&
    typeof sourceSnapshot.source === "object" &&
    !Array.isArray(sourceSnapshot.source)
  ) {
    sourceSnapshot.source = { ...sourceSnapshot.source, freshness: "stale" };
  }
  const booking = { ...item?.booking };
  if (values.bookingReference.trim()) booking.reference = values.bookingReference.trim();
  else delete booking.reference;
  if (values.bookingUrl.trim()) booking.url = values.bookingUrl.trim();
  else delete booking.url;
  const transport = { ...item?.transport };
  const transportChanged =
    values.transportMode.trim() !== objectString(item?.transport, "mode") ||
    values.transportDetails.trim() !== objectString(item?.transport, "details");
  if (values.transportMode.trim()) transport.mode = values.transportMode.trim();
  else delete transport.mode;
  if (values.transportDetails.trim()) transport.details = values.transportDetails.trim();
  else delete transport.details;
  if (transportChanged && transport.availability === "available") transport.freshness = "stale";
  if (
    transportChanged &&
    transport.route &&
    typeof transport.route === "object" &&
    !Array.isArray(transport.route) &&
    (transport.route as Record<string, unknown>).availability === "available"
  ) {
    transport.route = {
      ...(transport.route as Record<string, unknown>),
      freshness: "stale",
    };
  }

  return {
    booking,
    confidence: item?.confidence ?? null,
    durationMinutes: values.durationMinutes ? Number(values.durationMinutes) : null,
    endTime: values.endTime || null,
    estimatedCost: values.costAmount
      ? {
          amountMinor: Math.round(Number(values.costAmount) * 100),
          currency: values.currency.toUpperCase(),
        }
      : null,
    itemType: values.itemType,
    notes: values.notes.trim() || null,
    placeId: values.placeId || null,
    sourceSnapshot,
    startTime: values.startTime || null,
    transport,
  };
}

export function ItineraryItemEditor({
  busy,
  item,
  mode,
  onCancel,
  onSubmit,
}: Readonly<{
  busy: boolean;
  item: TripItem | null;
  mode: ItemEditorMode;
  onCancel: () => void;
  onSubmit: (draft: ItemDraft) => Promise<void>;
}>) {
  const [values, setValues] = useState(() => initialValues(item));
  const [errors, setErrors] = useState<string[]>([]);
  const titleId = useId();
  const copy = modeCopy[mode];

  function field<K extends keyof FormValues>(name: K) {
    return {
      name,
      onChange: (
        event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
      ) => setValues((current) => ({ ...current, [name]: event.target.value })),
      value: values[name],
    };
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate(values);
    setErrors(nextErrors);
    if (nextErrors.length > 0) return;
    await onSubmit(toDraft(values, item));
  }

  return (
    <div className="itinerary-editor-backdrop">
      <dialog aria-labelledby={titleId} className="itinerary-editor" open>
        <div className="itinerary-editor__heading">
          <div>
            <p className="eyebrow">Manual itinerary control</p>
            <h2 id={titleId}>{copy.title}</h2>
          </div>
          <button aria-label="Close item editor" disabled={busy} onClick={onCancel} type="button">
            ×
          </button>
        </div>
        <p className="itinerary-editor__context">
          Saved context stays visible. Manually changing a place or transport marks its saved source
          or route snapshot stale. Scheduling conflicts are explained, not silently corrected.
        </p>
        <form onSubmit={(event) => void submit(event)}>
          {errors.length > 0 ? (
            <div className="itinerary-editor__errors" role="alert">
              <strong>Check the item details</strong>
              <ul>
                {errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="itinerary-editor__grid">
            <label>
              Item type
              <select {...field("itemType")}>
                <option value="activity">Activity</option>
                <option value="food">Food</option>
                <option value="lodging">Lodging</option>
                <option value="transport">Transport</option>
                <option value="note">Note</option>
              </select>
            </label>
            <label>
              Place or item name
              <input {...field("placeName")} autoFocus maxLength={300} />
            </label>
            <label className="is-wide">
              Address
              <input {...field("address")} maxLength={500} />
            </label>
            <label>
              Start time
              <input {...field("startTime")} type="time" />
            </label>
            <label>
              End time
              <input {...field("endTime")} type="time" />
            </label>
            <label>
              Duration (minutes)
              <input {...field("durationMinutes")} min="1" step="1" type="number" />
            </label>
            <label>
              Cost estimate
              <input {...field("costAmount")} min="0" step="0.01" type="number" />
            </label>
            <label>
              Currency
              <input {...field("currency")} maxLength={3} />
            </label>
            <label>
              Transport mode
              <input {...field("transportMode")} placeholder="Walking, train, taxi…" />
            </label>
            <label className="is-wide">
              Transport details
              <input
                {...field("transportDetails")}
                placeholder="Line, pickup point, instructions…"
              />
            </label>
            <label>
              Booking reference
              <input {...field("bookingReference")} autoComplete="off" />
            </label>
            <label>
              Booking URL
              <input {...field("bookingUrl")} inputMode="url" type="url" />
            </label>
            <label className="is-wide">
              Canonical place ID (optional)
              <input {...field("placeId")} autoComplete="off" />
            </label>
            <label className="is-wide">
              Notes
              <textarea {...field("notes")} maxLength={10_000} rows={4} />
            </label>
          </div>
          <div className="itinerary-editor__actions">
            <button disabled={busy} onClick={onCancel} type="button">
              Cancel
            </button>
            <button className="is-primary" disabled={busy} type="submit">
              {busy ? "Saving…" : copy.action}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
