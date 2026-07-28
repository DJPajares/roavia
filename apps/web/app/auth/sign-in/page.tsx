import type { Metadata } from "next";

import { AuthForm } from "../../../components/auth-form";
import { signIn } from "../actions";

export const metadata: Metadata = { title: "Sign in" };

interface SignInPageProps {
  searchParams: Promise<{ next?: string; reason?: string; status?: string }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const parameters = await searchParams;
  const nextPath = parameters.next?.startsWith("/") ? parameters.next : "/trips";
  const notice =
    parameters.status === "signed-out"
      ? "You are signed out on this device."
      : parameters.reason === "invalid"
        ? "Your session ended. Sign in again to continue."
        : parameters.reason === "configuration"
          ? "Authentication is not configured in this environment."
          : parameters.reason === "missing"
            ? "Sign in to continue to your Roavia workspace."
            : null;

  return (
    <section className="auth-layout">
      <div className="auth-layout__intro">
        <p className="eyebrow">Welcome back</p>
        <h1>Continue planning with your context intact.</h1>
        <p>
          Your account keeps saved trips and personal travel choices available only to your
          authenticated session.
        </p>
      </div>
      <div className="auth-panel">
        <h2>Sign in to Roavia</h2>
        {notice ? <output className="auth-panel__notice">{notice}</output> : null}
        <AuthForm action={signIn} mode="sign-in" nextPath={nextPath} />
      </div>
    </section>
  );
}
