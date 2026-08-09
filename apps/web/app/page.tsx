import { ExploreHome } from "../components/explore-home";
import { getAuthSession } from "../lib/auth/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getAuthSession();
  return <ExploreHome isSignedIn={Boolean(session)} />;
}
