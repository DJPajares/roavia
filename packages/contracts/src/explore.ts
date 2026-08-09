import { z } from "zod";

import { destinationPlaceTypeSchema } from "./destinations";
import { httpsUrlSchema } from "./security";

const exploreMetaSchema = z.object({ requestId: z.string().uuid() });

export const seasonalCollectionResponseSchema = z.object({
  data: z.object({
    collections: z.array(
      z.object({
        destination: z.object({
          countryCode: z
            .string()
            .regex(/^[A-Z]{2}$/)
            .nullable(),
          id: z.string().uuid(),
          name: z.string().min(1),
          type: destinationPlaceTypeSchema,
        }),
        freshness: z.enum(["fresh", "partial", "stale"]),
        period: z.object({ endDate: z.string().date(), startDate: z.string().date() }),
        rating: z.enum([
          "challenging",
          "favorable",
          "insufficient_evidence",
          "mixed",
          "very_favorable",
        ]),
        reason: z.string().min(1),
        refreshedAt: z.string().datetime(),
        sources: z.array(
          z.object({
            id: z.string().min(1),
            retrievedAt: z.string().datetime(),
            title: z.string().nullable(),
            url: httpsUrlSchema,
          }),
        ),
        tradeoffs: z.array(z.string()),
      }),
    ),
  }),
  meta: exploreMetaSchema,
});

export type SeasonalCollectionResponse = z.infer<typeof seasonalCollectionResponseSchema>;
