"use client";

import { ApiClientError, createRoaviaApiClient } from "@roavia/api-client";
import type { ShareLink } from "@roavia/contracts";
import { Button } from "@roavia/ui";
import { useCallback, useEffect, useMemo, useState } from "react";

import { createClient } from "../lib/supabase/client";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function shareError(error: unknown) {
  if (error instanceof ApiClientError && error.status === 404) {
    return "This trip is no longer available to your account.";
  }
  return error instanceof Error ? error.message : "Trip sharing could not be updated.";
}

export function TripShareControls({ tripId }: Readonly<{ tripId: string }>) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [newShareUrl, setNewShareUrl] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const api = useMemo(
    () =>
      createRoaviaApiClient({
        accessToken: async () =>
          (await createClient().auth.getSession()).data.session?.access_token ?? null,
        baseUrl: apiBaseUrl,
      }),
    [],
  );

  const loadLinks = useCallback(async () => {
    try {
      const response = await api.listShareLinks(tripId);
      setLinks(response.data.links.toReversed());
    } catch (error) {
      setMessage(shareError(error));
    }
  }, [api, tripId]);

  useEffect(() => {
    void loadLinks();
  }, [loadLinks]);

  async function createLink() {
    setBusy(true);
    setMessage("");
    try {
      const response = await api.createShareLink(tripId, { expiresInDays });
      const shareUrl = `${window.location.origin}/shared/${response.data.token}`;
      setNewShareUrl(shareUrl);
      setLinks((current) => [response.data.link, ...current]);
      setMessage("Read-only link created. Copy it now; Roavia does not store the raw link.");
    } catch (error) {
      setMessage(shareError(error));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(newShareUrl);
      setMessage("Share link copied.");
    } catch {
      setMessage("Copy was blocked by your browser. Select and copy the link manually.");
    }
  }

  async function revokeLink(linkId: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await api.revokeShareLink(tripId, linkId);
      setLinks((current) =>
        current.map((link) =>
          link.id === linkId
            ? { ...link, revokedAt: response.data.revokedAt, status: "revoked" }
            : link,
        ),
      );
      setNewShareUrl("");
      setMessage("Share link revoked. It can no longer open this trip.");
    } catch (error) {
      setMessage(shareError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="trip-sharing-heading" className="trip-sharing">
      <div className="trip-sharing__heading">
        <div>
          <p className="eyebrow">Private coordination</p>
          <h2 id="trip-sharing-heading">Read-only sharing</h2>
        </div>
        <div className="trip-sharing__create">
          <label htmlFor="share-expiry">Expires after</label>
          <select
            disabled={busy}
            id="share-expiry"
            onChange={(event) => setExpiresInDays(Number(event.target.value))}
            value={expiresInDays}
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
          </select>
          <Button disabled={busy} onClick={() => void createLink()}>
            {busy ? "Updating…" : "Create link"}
          </Button>
        </div>
      </div>
      <p>
        Anyone with an active link can view approved itinerary details. Your account, profile,
        traveler summary, budget, and booking metadata stay private.
      </p>

      {newShareUrl ? (
        <div className="trip-sharing__new-link">
          <label htmlFor="new-share-link">New link — shown once</label>
          <input id="new-share-link" readOnly value={newShareUrl} />
          <div>
            <Button onClick={() => void copyLink()} tone="quiet">
              Copy link
            </Button>
            <a
              className="roavia-button roavia-button--quiet"
              href={newShareUrl}
              rel="noreferrer"
              target="_blank"
            >
              Open preview
            </a>
          </div>
        </div>
      ) : null}

      {message ? <output className="trip-sharing__message">{message}</output> : null}
      {links.length > 0 ? (
        <ul className="trip-sharing__links">
          {links.map((link) => (
            <li key={link.id}>
              <div>
                <strong>
                  {link.status === "active" ? "Active read-only link" : `${link.status} link`}
                </strong>
                <span>
                  Created {formatDateTime(link.createdAt)} · expires{" "}
                  {formatDateTime(link.expiresAt)}
                </span>
              </div>
              {link.status === "active" ? (
                <Button disabled={busy} onClick={() => void revokeLink(link.id)} tone="quiet">
                  Revoke
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="trip-sharing__empty">No share links have been created for this trip.</p>
      )}
    </section>
  );
}
