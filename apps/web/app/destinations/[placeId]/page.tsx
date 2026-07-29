import { DestinationEncyclopedia } from "../../../components/destination-encyclopedia";

export default async function DestinationPage({
  params,
}: {
  params: Promise<{ placeId: string }>;
}) {
  const { placeId } = await params;
  return <DestinationEncyclopedia placeId={placeId} />;
}
