import { createPwaIcon } from "../../lib/pwa-icon";

export const dynamic = "force-static";

export function GET() {
  return createPwaIcon(192);
}
