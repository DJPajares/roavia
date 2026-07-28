import { redirect } from "next/navigation";

import { GuidedTripPlanner } from "../../components/guided-trip-planner";
import { getAuthSession } from "../../lib/auth/session";

export const dynamic = "force-dynamic";

export default async function PlanPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ tripId?: string }> }>) {
  const session = await getAuthSession();
  if (!session) redirect("/auth/sign-in?next=%2Fplan&reason=missing");
  const { tripId } = await searchParams;
  return <GuidedTripPlanner resumeTripId={tripId} />;
}
