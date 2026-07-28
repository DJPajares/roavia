import { createRoaviaApiClient } from "@roavia/api-client";
import type { HealthResponse } from "@roavia/contracts";

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.API_BASE_URL ?? "http://localhost:8787";

export const roaviaApi = createRoaviaApiClient({ baseUrl: apiBaseUrl });

export type { HealthResponse };
