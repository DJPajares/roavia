import type { Metadata } from "next";

import { AuthForm } from "../../../components/auth-form";
import { signUp } from "../actions";

export const metadata: Metadata = { title: "Create account" };

interface SignUpPageProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const parameters = await searchParams;
  const nextPath = parameters.next?.startsWith("/") ? parameters.next : "/trips";

  return (
    <section className="auth-layout">
      <div className="auth-layout__intro">
        <p className="eyebrow">Your planning home</p>
        <h1>Save the journey without giving up control.</h1>
        <p>
          Create an account to keep trips, preferences, and future offline plans tied to one secure
          identity.
        </p>
      </div>
      <div className="auth-panel">
        <h2>Create your account</h2>
        <p className="auth-panel__notice">
          Use at least 8 characters. Roavia never receives your provider password in client code.
        </p>
        <AuthForm action={signUp} mode="sign-up" nextPath={nextPath} />
      </div>
    </section>
  );
}
