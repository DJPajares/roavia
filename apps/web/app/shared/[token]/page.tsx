import type { Metadata } from "next";

import { SharedItinerary } from "../../../components/shared-itinerary";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shared trip",
  robots: { follow: false, index: false },
};

export default async function SharedTripPage({
  params,
}: Readonly<{ params: Promise<{ token: string }> }>) {
  const { token } = await params;
  return <SharedItinerary token={token} />;
}
