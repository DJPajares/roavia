import { z } from "zod";

import { defaultJobPolicy, defineJob } from "./contracts.js";

export const destinationCatalogIngestionPayloadSchema = z.object({
  catalogKey: z.literal("mvp-launch-v1"),
  mode: z.enum(["seed", "refresh"]),
});

export type DestinationCatalogIngestionPayload = z.infer<
  typeof destinationCatalogIngestionPayloadSchema
>;

export interface DestinationCatalogIngestionService {
  ingest(payload: DestinationCatalogIngestionPayload): Promise<Record<string, number | string>>;
}

export function createDestinationCatalogIngestionJob(service: DestinationCatalogIngestionService) {
  return defineJob({
    handler: async (payload, _envelope, context) => {
      if (context.signal.aborted) throw new DOMException("Aborted", "AbortError");
      return service.ingest(payload);
    },
    payloadSchema: destinationCatalogIngestionPayloadSchema,
    payloadVersion: 1,
    policy: {
      ...defaultJobPolicy,
      concurrency: 1,
      timeoutMs: 5 * 60 * 1_000,
    },
    type: "destination.catalog-ingest.v1",
  });
}
