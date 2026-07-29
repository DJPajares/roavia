import { redirect } from "next/navigation";

import { AssistantWorkspace } from "../../components/assistant-workspace";
import { getAuthSession } from "../../lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  const session = await getAuthSession();
  if (!session) {
    redirect("/auth/sign-in?next=%2Fassistant&reason=missing");
  }

  return <AssistantWorkspace email={session.identity.email} />;
}
