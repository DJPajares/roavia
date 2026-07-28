"use server";

import { authCredentialsSchema } from "@roavia/contracts";
import { redirect } from "next/navigation";

import type { AuthActionState } from "../../lib/auth/action-state";
import { createClient } from "../../lib/supabase/server";

function safeNextPath(candidate: FormDataEntryValue | null): string {
  if (typeof candidate !== "string" || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return "/trips";
  }

  return candidate;
}

function credentials(formData: FormData) {
  return authCredentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
}

function configurationError(): AuthActionState {
  return {
    message: "Authentication is not configured in this environment.",
    status: "error",
  };
}

export async function signIn(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = credentials(formData);
  if (!parsed.success) {
    return {
      message: "Enter a valid email and a password of at least 8 characters.",
      status: "error",
    };
  }

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return configurationError();
  }

  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return {
      message: "That email and password were not accepted.",
      status: "error",
    };
  }

  redirect(safeNextPath(formData.get("next")));
}

export async function signUp(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = credentials(formData);
  if (!parsed.success) {
    return {
      message: "Enter a valid email and a password of at least 8 characters.",
      status: "error",
    };
  }

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return configurationError();
  }

  const { data, error } = await supabase.auth.signUp(parsed.data);
  if (error) {
    return {
      message: "We could not create that account. Check the details and try again.",
      status: "error",
    };
  }

  if (!data.session) {
    return {
      message: "Check your email to confirm your account, then sign in.",
      status: "success",
    };
  }

  redirect(safeNextPath(formData.get("next")));
}

export async function signOut(): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // A missing or invalid local session is already signed out from the app's perspective.
  }

  redirect("/auth/sign-in?status=signed-out");
}
