import type {
  ProviderAdapterResult,
  ProviderRequestContext,
  TravelDataAdapter,
  TravelDataClass,
} from "./contracts.js";

export type FixtureProviderStep<TValue> =
  { result: ProviderAdapterResult<TValue> } | { throw: unknown } | { waitForAbort: true };

/** Deterministic adapter for contract tests. It performs no network or quota-consuming calls. */
export class FixtureTravelDataAdapter<TInput, TValue> implements TravelDataAdapter<TInput, TValue> {
  readonly calls: Array<{ context: ProviderRequestContext; input: TInput }> = [];
  readonly dataClass: TravelDataClass;
  readonly operation: string;
  readonly provider: string;

  private cursor = 0;
  private readonly steps: readonly FixtureProviderStep<TValue>[];
  private readonly support?: (
    context: Pick<ProviderRequestContext, "locale" | "region">,
  ) => boolean;

  constructor(input: {
    dataClass: TravelDataClass;
    operation: string;
    provider: string;
    steps: readonly FixtureProviderStep<TValue>[];
    supports?: (context: Pick<ProviderRequestContext, "locale" | "region">) => boolean;
  }) {
    if (input.steps.length === 0) throw new Error("Fixture adapters require at least one step.");
    this.dataClass = input.dataClass;
    this.operation = input.operation;
    this.provider = input.provider;
    this.steps = input.steps;
    this.support = input.supports;
  }

  supports(context: Pick<ProviderRequestContext, "locale" | "region">) {
    return this.support?.(context) ?? true;
  }

  async execute(input: TInput, context: ProviderRequestContext) {
    this.calls.push({ context, input });
    const step = this.steps[Math.min(this.cursor, this.steps.length - 1)]!;
    this.cursor += 1;

    if ("throw" in step) throw step.throw;
    if ("waitForAbort" in step) {
      return new Promise<ProviderAdapterResult<TValue>>((_, reject) => {
        if (context.signal.aborted) {
          reject(context.signal.reason ?? new DOMException("Aborted", "AbortError"));
          return;
        }
        context.signal.addEventListener(
          "abort",
          () => reject(context.signal.reason ?? new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    }
    return step.result;
  }
}
