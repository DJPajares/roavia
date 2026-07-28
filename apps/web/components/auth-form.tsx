"use client";

import Link from "next/link";
import { useActionState } from "react";

import { initialAuthActionState, type AuthActionState } from "../lib/auth/action-state";

interface AuthFormProps {
  action: (state: AuthActionState, formData: FormData) => Promise<AuthActionState>;
  mode: "sign-in" | "sign-up";
  nextPath: string;
}

export function AuthForm({ action, mode, nextPath }: AuthFormProps) {
  const [state, formAction, pending] = useActionState(action, initialAuthActionState);
  const signingIn = mode === "sign-in";

  return (
    <form action={formAction} className="auth-form">
      <input name="next" type="hidden" value={nextPath} />
      <label>
        <span>Email address</span>
        <input autoComplete="email" name="email" required type="email" />
      </label>
      <label>
        <span>Password</span>
        <input
          autoComplete={signingIn ? "current-password" : "new-password"}
          minLength={8}
          name="password"
          required
          type="password"
        />
      </label>
      <p
        aria-live="polite"
        className={state.status === "error" ? "auth-form__message is-error" : "auth-form__message"}
      >
        {state.message}
      </p>
      <button className="roavia-button roavia-button--accent" disabled={pending} type="submit">
        {pending ? "Working…" : signingIn ? "Sign in" : "Create account"}
      </button>
      <p className="auth-form__switch">
        {signingIn ? "New to Roavia?" : "Already have an account?"}{" "}
        <Link
          href={`${signingIn ? "/auth/sign-up" : "/auth/sign-in"}?next=${encodeURIComponent(nextPath)}`}
        >
          {signingIn ? "Create an account" : "Sign in"}
        </Link>
      </p>
    </form>
  );
}
