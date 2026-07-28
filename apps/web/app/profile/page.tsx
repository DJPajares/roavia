import { redirect } from "next/navigation";

import { SignOutButton } from "../../components/sign-out-button";
import { getAuthSession } from "../../lib/auth/session";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await getAuthSession();
  if (!session) {
    redirect("/auth/sign-in?next=%2Fprofile&reason=missing");
  }

  return (
    <section className="profile-session">
      <p className="eyebrow">Your authenticated session</p>
      <h1>A profile that stays in your control.</h1>
      <div className="profile-session__details">
        <div>
          <span>Signed in as</span>
          <strong>{session.identity.email ?? session.identity.userId}</strong>
        </div>
        <div>
          <span>Session expires</span>
          <strong>
            {new Date(session.expiresAt).toLocaleString("en", { timeZone: "UTC" })} UTC
          </strong>
        </div>
      </div>
      <SignOutButton />
    </section>
  );
}
