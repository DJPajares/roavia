import { z } from "zod";

import { defaultJobPolicy, defineJob } from "./contracts.js";
import { permanentJobFailure, transientJobFailure } from "./errors.js";

export const referenceJobPayloadSchema = z.object({
  effectKey: z.string().min(1).max(200),
  revision: z.number().int().positive(),
});

export interface ReferenceEffectStore {
  applyOnce(effectKey: string): Promise<boolean>;
}

export class MemoryReferenceEffectStore implements ReferenceEffectStore {
  readonly applied = new Set<string>();

  async applyOnce(effectKey: string) {
    if (this.applied.has(effectKey)) return false;
    this.applied.add(effectKey);
    return true;
  }
}

export function createReferenceJob(
  effects: ReferenceEffectStore,
  options: { failPermanently?: boolean; transientFailures?: number } = {},
) {
  let transientFailures = 0;
  return defineJob({
    handler: async (payload, _envelope, context) => {
      if (context.signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (options.failPermanently) {
        throw permanentJobFailure("reference_permanent_failure", "Reference job cannot succeed.");
      }
      if (transientFailures < (options.transientFailures ?? 0)) {
        transientFailures += 1;
        throw transientJobFailure(
          "reference_transient_failure",
          "Reference job should be retried.",
        );
      }
      const applied = await effects.applyOnce(`${payload.effectKey}:${payload.revision}`);
      return { applied };
    },
    payloadSchema: referenceJobPayloadSchema,
    payloadVersion: 1,
    policy: {
      ...defaultJobPolicy,
      concurrency: 2,
      deadLetterQueue: "system.reference.dead-letter.v1",
      retry: {
        ...defaultJobPolicy.retry,
        initialDelayMs: 100,
        jitterRatio: 0,
        maxDelayMs: 1_000,
      },
      timeoutMs: 2_000,
    },
    type: "system.reference-effect.v1",
  });
}
