import { redirect } from "next/navigation";

import { OfflineLibrary } from "../../components/offline-library";
import { getAuthSession } from "../../lib/auth/session";

export const dynamic = "force-dynamic";

export default async function OfflinePage() {
  const session = await getAuthSession();
  if (!session) {
    redirect("/auth/sign-in?next=%2Foffline&reason=missing");
  }

  return <OfflineLibrary email={session.identity.email} ownerId={session.identity.userId} />;
}
