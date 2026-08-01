"use client";

import { clearOfflinePackages } from "@roavia/offline/browser";
import { useState } from "react";

import { signOut } from "../app/auth/actions";

const offlineRuntimeCache = "roavia-runtime-v2";

export function SignOutButton({ ownerId }: Readonly<{ ownerId: string }>) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function signOutSafely() {
    if (pending) return;
    setPending(true);
    setMessage("");
    try {
      await clearOfflinePackages(ownerId);
      if ("caches" in globalThis) await caches.delete(offlineRuntimeCache);
      await signOut();
    } catch {
      setMessage(
        "Roavia could not safely clear this account's offline data. Retry before signing out.",
      );
      setPending(false);
    }
  }

  return (
    <div>
      <p>Signing out removes this account&apos;s offline downloads from this browser.</p>
      {message ? <output aria-live="polite">{message}</output> : null}
      <button
        className="roavia-button roavia-button--quiet"
        disabled={pending}
        onClick={() => void signOutSafely()}
        type="button"
      >
        {pending ? "Clearing offline data…" : "Sign out"}
      </button>
    </div>
  );
}
