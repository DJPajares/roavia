import { redirect } from "next/navigation";

import { ItineraryWorkspace } from "../../../components/itinerary-workspace";
import { getAuthSession } from "../../../lib/auth/session";

export const dynamic = "force-dynamic";

export default async function ItineraryPage({
  params,
}: Readonly<{ params: Promise<{ tripId: string }> }>) {
  const { tripId } = await params;
  const session = await getAuthSession();
  if (!session) {
    redirect(`/auth/sign-in?next=${encodeURIComponent(`/trips/${tripId}`)}&reason=missing`);
  }

  return (
    <ItineraryWorkspace
      email={session.identity.email}
      ownerId={session.identity.userId}
      tripId={tripId}
    />
  );
}
