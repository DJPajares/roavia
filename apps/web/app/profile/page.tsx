import { redirect } from "next/navigation";

import { ProfilePreferences } from "../../components/profile-preferences";
import { AccountPrivacyControls } from "../../components/account-privacy-controls";
import { SignOutButton } from "../../components/sign-out-button";
import { getAuthSession } from "../../lib/auth/session";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await getAuthSession();
  if (!session) {
    redirect("/auth/sign-in?next=%2Fprofile&reason=missing");
  }

  return (
    <div className="profile-page">
      <ProfilePreferences email={session.identity.email} />
      <AccountPrivacyControls email={session.identity.email} ownerId={session.identity.userId} />
      <div className="profile-page__sign-out">
        <SignOutButton ownerId={session.identity.userId} />
      </div>
    </div>
  );
}
