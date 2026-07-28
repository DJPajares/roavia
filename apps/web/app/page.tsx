import { TrustNotice } from "@roavia/ui";

import { DestinationSearch } from "../components/destination-search";

export default function HomePage() {
  return (
    <>
      <DestinationSearch />
      <TrustNotice label="Designed for trust">
        Destination results use Roavia’s normalized place hierarchy. Provider identifiers and raw
        source records never leave the server.
      </TrustNotice>
    </>
  );
}
