import { redirect } from "next/navigation";

import { TripsDashboard } from "../../components/trips-dashboard";
import { getAuthSession } from "../../lib/auth/session";

export const dynamic = "force-dynamic";

export default async function TripsPage() {
  const session = await getAuthSession();
  if (!session) {
    redirect("/auth/sign-in?next=%2Ftrips&reason=missing");
  }

  return <TripsDashboard email={session.identity.email} />;
}
