import {
  createTravelDataCacheKey,
  type TravelDataCache,
  type TravelDataCacheEntry,
  validateCachePolicy,
} from "./cache.js";
import type {
  ProviderAdapterResult,
  ProviderFailure,
  ProviderQuota,
  ProviderSuccess,
  ProviderUnavailable,
  TravelDataAdapter,
  TravelDataFailure,
  TravelDataFreshness,
  TravelDataOperation,
  TravelDataRequestContext,
  TravelDataResult,
  TravelDataStale,
  TravelDataSuccess,
  TravelDataTelemetryEvent,
  TravelDataTelemetrySink,
} from "./contracts.js";
import { getProviderFailureTrigger, providerError } from "./contracts.js";
import {
  calculateRetryDelay,
  MemoryProviderCircuitBreaker,
  type ProviderCircuitBreaker,
  sleepWithSignal,
  validateExecutionPolicy,
} from "./resilience.js";
import { validateAdapterResult } from "./validation.js";

export interface TravelDataCoordinatorOptions {
  cache?: TravelDataCache;
  circuitBreaker?: ProviderCircuitBreaker;
  clock?: () => Date;
  jitter?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  telemetry?: TravelDataTelemetrySink;
}

export interface TravelDataProviderSet<TInput, TValue> {
  fallbacks?: readonly TravelDataAdapter<TInput, TValue>[];
  primary: TravelDataAdapter<TInput, TValue>;
}

interface CacheRead<TValue> {
  entry: TravelDataCacheEntry<TValue>;
  state: "fresh" | "stale";
}

export class TravelDataCoordinator<TInput, TValue> {
  private readonly cache?: TravelDataCache;
  private readonly circuitBreaker: ProviderCircuitBreaker;
  private readonly clock: () => Date;
  private readonly fallbacks: readonly TravelDataAdapter<TInput, TValue>[];
  private readonly inFlight = new Map<string, Promise<TravelDataResult<TValue>>>();
  private readonly jitter: () => number;
  private readonly operation: TravelDataOperation<TInput, TValue>;
  private readonly primary: TravelDataAdapter<TInput, TValue>;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly telemetry?: TravelDataTelemetrySink;

  constructor(
    operation: TravelDataOperation<TInput, TValue>,
    providers: TravelDataProviderSet<TInput, TValue>,
    options: TravelDataCoordinatorOptions = {},
  ) {
    validateCachePolicy(operation.cachePolicy);
    validateExecutionPolicy(operation.executionPolicy);
    if (operation.cachePolicy.dataClass !== operation.dataClass) {
      throw new Error("Cache policy dataClass must match the travel-data operation.");
    }
    this.assertAdapter(operation, providers.primary);
    for (const adapter of providers.fallbacks ?? []) this.assertAdapter(operation, adapter);

    const providerNames = [providers.primary, ...(providers.fallbacks ?? [])].map(
      (adapter) => adapter.provider,
    );
    if (new Set(providerNames).size !== providerNames.length) {
      throw new Error("A provider may only appear once in an operation's fallback chain.");
    }

    this.cache = options.cache;
    this.circuitBreaker = options.circuitBreaker ?? new MemoryProviderCircuitBreaker();
    this.clock = options.clock ?? (() => new Date());
    this.fallbacks = providers.fallbacks ?? [];
    this.jitter = options.jitter ?? Math.random;
    this.operation = operation;
    this.primary = providers.primary;
    this.sleep = options.sleep ?? sleepWithSignal;
    this.telemetry = options.telemetry;
  }

  async execute(
    input: TInput,
    context: TravelDataRequestContext = {},
  ): Promise<TravelDataResult<TValue>> {
    const requestId = context.requestId ?? crypto.randomUUID();
    if (context.signal?.aborted) return this.cancelled(this.primary, requestId, 0);

    let primaryKey: string;
    try {
      primaryKey = await this.cacheKey(this.primary, input, context);
    } catch {
      return this.decorateFailure(
        providerError(
          this.primary.provider,
          this.operation.name,
          "invalid_request",
          "Travel-data cache input could not be normalized.",
          false,
        ),
        requestId,
        0,
      );
    }

    const cached = await this.readCache(this.primary, primaryKey, requestId);
    if (cached) {
      const result = this.fromCache(cached, requestId, 0);
      if (cached.state === "stale") {
        this.scheduleRevalidation(this.primary, primaryKey, input, context, requestId);
        result.freshness.revalidating = true;
      }
      return result;
    }

    const result = await this.singleFlight(primaryKey, () =>
      this.executeNetworkChain(input, context, requestId),
    );
    return result.requestId === requestId ? result : { ...result, requestId };
  }

  /** Useful for graceful shutdown and deterministic fixture tests. */
  async waitForRevalidations() {
    await Promise.allSettled(this.inFlight.values());
  }

  private async executeNetworkChain(
    input: TInput,
    context: TravelDataRequestContext,
    requestId: string,
  ): Promise<TravelDataResult<TValue>> {
    const primaryResult = await this.fetchProvider(this.primary, input, context, requestId);
    if (primaryResult.status === "success" || primaryResult.status === "stale") {
      return primaryResult;
    }

    const fallbackPolicy = this.operation.fallback;
    if (
      !fallbackPolicy ||
      !fallbackPolicy.triggers.includes(getProviderFailureTrigger(primaryResult))
    ) {
      return primaryResult;
    }

    let attempts = primaryResult.attempts;
    for (const adapter of this.fallbacks) {
      if (context.signal?.aborted) return this.cancelled(adapter, requestId, attempts);

      const key = await this.cacheKey(adapter, input, context);
      const cached = await this.readCache(adapter, key, requestId);
      let candidate = cached
        ? this.fromCache(cached, requestId, 0)
        : await this.fetchProvider(adapter, input, context, requestId);
      attempts += candidate.attempts;

      if (candidate.status !== "success" && candidate.status !== "stale") continue;
      const providerCandidate = this.toProviderSuccess(candidate);
      if (
        !fallbackPolicy.accepts({ candidate: providerCandidate, primaryFailure: primaryResult })
      ) {
        continue;
      }

      if (cached?.state === "stale") {
        this.scheduleRevalidation(adapter, key, input, context, requestId);
        candidate.freshness.revalidating = true;
      }
      candidate = { ...candidate, attempts, fallbackFrom: this.primary.provider };
      await this.emit({
        event: "fallback_selected",
        fallbackFrom: this.primary.provider,
        provider: adapter.provider,
        requestId,
        resultStatus: candidate.status,
      });
      return candidate;
    }

    return {
      attempts,
      operation: this.operation.name,
      provider: this.primary.provider,
      reason: "no_safe_fallback",
      requestId,
      status: "unavailable",
    };
  }

  private async fetchProvider(
    adapter: TravelDataAdapter<TInput, TValue>,
    input: TInput,
    context: TravelDataRequestContext,
    requestId: string,
  ): Promise<TravelDataResult<TValue>> {
    if (adapter.supports && !adapter.supports({ locale: context.locale, region: context.region })) {
      return {
        attempts: 0,
        operation: this.operation.name,
        provider: adapter.provider,
        reason: "unsupported_coverage",
        requestId,
        status: "unavailable",
      };
    }

    const circuitKey = `${adapter.provider}:${adapter.operation}`;
    const circuitPolicy = this.operation.executionPolicy.circuitBreaker;
    const permit = this.circuitBreaker.acquire(circuitKey, circuitPolicy, this.clock().getTime());
    if (!permit.allowed) {
      return {
        attempts: 0,
        operation: this.operation.name,
        provider: adapter.provider,
        reason: "circuit_open",
        requestId,
        retryAfterMs: permit.retryAfterMs,
        status: "unavailable",
      };
    }

    const retryPolicy = this.operation.executionPolicy.retry;
    let attempts = 0;
    while (attempts < retryPolicy.maxAttempts) {
      attempts += 1;
      const startedAt = this.clock().getTime();
      const providerResult = await this.invokeAdapter(adapter, input, context, requestId);
      await this.emit({
        attempt: attempts,
        durationMs: Math.max(0, this.clock().getTime() - startedAt),
        errorCode: providerResult.status === "error" ? providerResult.error.code : undefined,
        event: "provider_attempt",
        provider: adapter.provider,
        quotaRemaining:
          providerResult.status === "quota"
            ? providerResult.remaining
            : providerResult.status === "success"
              ? providerResult.usage?.quotaRemaining
              : undefined,
        requestId,
        resultStatus: providerResult.status,
        usageCostUnits:
          providerResult.status === "success" ? providerResult.usage?.costUnits : undefined,
      });

      if (providerResult.status === "success") {
        const freshness = this.createFreshness(providerResult, "network", false);
        if (!freshness) {
          const invalid = providerError(
            adapter.provider,
            adapter.operation,
            "invalid_response",
            "Provider success was already outside its source freshness window.",
            true,
          );
          return this.finishFailure(adapter, invalid, requestId, attempts, circuitKey);
        }
        this.circuitBreaker.recordSuccess(circuitKey);
        await this.writeCache(adapter, input, context, providerResult, freshness, requestId);
        return {
          ...providerResult,
          attempts,
          freshness,
          requestId,
        };
      }

      if (this.shouldRetry(providerResult) && attempts < retryPolicy.maxAttempts) {
        const retryAfterMs = this.retryAfter(providerResult);
        if (retryAfterMs !== undefined && retryAfterMs > retryPolicy.maxDelayMs) {
          return this.finishFailure(adapter, providerResult, requestId, attempts, circuitKey);
        }
        const delay = calculateRetryDelay(retryPolicy, attempts, this.jitter, retryAfterMs);
        await this.emit({
          attempt: attempts,
          event: "retry_scheduled",
          provider: adapter.provider,
          requestId,
          retryDelayMs: delay,
        });
        try {
          await this.sleep(delay, context.signal);
        } catch {
          return this.cancelled(adapter, requestId, attempts);
        }
        continue;
      }

      return this.finishFailure(adapter, providerResult, requestId, attempts, circuitKey);
    }

    return this.decorateFailure(
      providerError(
        adapter.provider,
        adapter.operation,
        "internal",
        "Provider execution ended without a normalized result.",
        false,
      ),
      requestId,
      attempts,
    );
  }

  private async invokeAdapter(
    adapter: TravelDataAdapter<TInput, TValue>,
    input: TInput,
    context: TravelDataRequestContext,
    requestId: string,
  ): Promise<ProviderAdapterResult<TValue>> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let removeAbortListener: (() => void) | undefined;

    const adapterCall = Promise.resolve()
      .then(() =>
        adapter.execute(input, {
          locale: context.locale,
          region: context.region,
          requestId,
          signal: controller.signal,
        }),
      )
      .catch(() =>
        providerError(
          adapter.provider,
          adapter.operation,
          "internal",
          "Provider request failed without a normalized error.",
          true,
        ),
      );

    const timeoutResult = new Promise<ProviderAdapterResult<TValue>>((resolve) => {
      timeout = setTimeout(() => {
        controller.abort();
        resolve(
          providerError(
            adapter.provider,
            adapter.operation,
            "timeout",
            "Provider request exceeded its execution timeout.",
            true,
          ),
        );
      }, this.operation.executionPolicy.timeoutMs);
    });

    const cancellation = new Promise<ProviderAdapterResult<TValue>>((resolve) => {
      if (!context.signal) return;
      const abort = () => {
        controller.abort(context.signal?.reason);
        resolve(
          providerError(
            adapter.provider,
            adapter.operation,
            "cancelled",
            "Travel-data request was cancelled.",
            false,
          ),
        );
      };
      context.signal.addEventListener("abort", abort, { once: true });
      removeAbortListener = () => context.signal?.removeEventListener("abort", abort);
    });

    try {
      const result = await Promise.race([adapterCall, timeoutResult, cancellation]);
      return validateAdapterResult(result, {
        operation: adapter.operation,
        provider: adapter.provider,
        validateValue: this.operation.validateValue,
      });
    } finally {
      if (timeout) clearTimeout(timeout);
      removeAbortListener?.();
    }
  }

  private finishFailure(
    adapter: TravelDataAdapter<TInput, TValue>,
    result: ProviderFailure | ProviderQuota | ProviderUnavailable,
    requestId: string,
    attempts: number,
    circuitKey: string,
  ): TravelDataFailure {
    if (this.isCircuitFailure(result)) {
      const opened = this.circuitBreaker.recordFailure(
        circuitKey,
        this.operation.executionPolicy.circuitBreaker,
        this.clock().getTime(),
      );
      if (opened) {
        void this.emit({
          errorCode: result.status === "error" ? result.error.code : undefined,
          event: "circuit_opened",
          provider: adapter.provider,
          requestId,
          resultStatus: result.status,
        });
      }
    } else {
      this.circuitBreaker.recordSuccess(circuitKey);
    }
    return this.decorateFailure(result, requestId, attempts);
  }

  private decorateFailure(
    result: ProviderFailure | ProviderQuota | ProviderUnavailable,
    requestId: string,
    attempts: number,
  ): TravelDataFailure {
    return { ...result, attempts, requestId };
  }

  private cancelled(
    adapter: TravelDataAdapter<TInput, TValue>,
    requestId: string,
    attempts: number,
  ) {
    return this.decorateFailure(
      providerError(
        adapter.provider,
        adapter.operation,
        "cancelled",
        "Travel-data request was cancelled.",
        false,
      ),
      requestId,
      attempts,
    );
  }

  private shouldRetry(result: ProviderFailure | ProviderQuota | ProviderUnavailable) {
    if (result.status === "error")
      return result.error.retryable && result.error.code !== "cancelled";
    if (result.status === "quota") {
      return (
        result.reason === "rate_limited" && this.operation.executionPolicy.retry.retryRateLimits
      );
    }
    return result.reason === "provider_unavailable";
  }

  private retryAfter(result: ProviderFailure | ProviderQuota | ProviderUnavailable) {
    if (result.status === "error") return result.error.retryAfterMs;
    return result.retryAfterMs;
  }

  private isCircuitFailure(result: ProviderFailure | ProviderQuota | ProviderUnavailable) {
    if (result.status === "quota") return false;
    if (result.status === "unavailable") return result.reason === "provider_unavailable";
    return ["internal", "invalid_response", "timeout", "unavailable"].includes(result.error.code);
  }

  private async cacheKey(
    adapter: TravelDataAdapter<TInput, TValue>,
    input: TInput,
    context: TravelDataRequestContext,
  ) {
    return createTravelDataCacheKey({
      input: this.operation.cacheKey(input, context),
      locale: context.locale,
      operation: this.operation.name,
      policy: this.operation.cachePolicy,
      provider: adapter.provider,
    });
  }

  private async readCache(
    adapter: TravelDataAdapter<TInput, TValue>,
    key: string,
    requestId: string,
  ): Promise<CacheRead<TValue> | undefined> {
    if (!this.cache || this.operation.cachePolicy.mode === "none") return undefined;
    const entry = await this.cache.get<TValue>(key);
    if (!entry) {
      await this.emit({
        event: "cache",
        cacheOutcome: "miss",
        provider: adapter.provider,
        requestId,
      });
      return undefined;
    }

    const policy = this.operation.cachePolicy;
    if (entry.policyKey !== policy.key || entry.policyVersion !== policy.version) {
      await this.cache.delete(key);
      await this.emit({
        event: "cache",
        cacheOutcome: "expired",
        provider: adapter.provider,
        requestId,
      });
      return undefined;
    }

    const now = this.clock().getTime();
    const expiresAt = Date.parse(entry.expiresAt);
    const staleAt = Date.parse(entry.staleAt);
    if (!Number.isFinite(expiresAt) || !Number.isFinite(staleAt) || expiresAt <= now) {
      await this.cache.delete(key);
      await this.emit({
        event: "cache",
        cacheOutcome: "expired",
        provider: adapter.provider,
        requestId,
      });
      return undefined;
    }

    const state = staleAt <= now ? "stale" : "fresh";
    await this.emit({
      cacheOutcome: state === "fresh" ? "hit" : "stale",
      event: "cache",
      provider: adapter.provider,
      requestId,
    });
    return { entry, state };
  }

  private fromCache(
    cached: CacheRead<TValue>,
    requestId: string,
    attempts: number,
  ): TravelDataStale<TValue> | TravelDataSuccess<TValue> {
    const { result } = cached.entry;
    const freshness: TravelDataFreshness = {
      cache: "hit",
      cachedAt: cached.entry.cachedAt,
      expiresAt: cached.entry.expiresAt,
      policyKey: cached.entry.policyKey,
      policyVersion: cached.entry.policyVersion,
      revalidating: false,
      staleAt: cached.entry.staleAt,
      state: cached.state,
    };
    if (cached.state === "fresh") {
      return {
        ...result,
        attempts,
        freshness,
        requestId,
        status: "success",
      };
    }
    return {
      ...result,
      attempts,
      freshness: { ...freshness, state: "stale" },
      requestId,
      status: "stale",
    };
  }

  private createFreshness(
    result: ProviderSuccess<TValue>,
    cache: TravelDataFreshness["cache"],
    revalidating: boolean,
  ): TravelDataFreshness | undefined {
    const now = this.clock().getTime();
    const policy = this.operation.cachePolicy;
    // validUntil describes when a fact or historical series applies. It may be
    // in the past while the retrieved record remains current and cacheable.
    // expiresAt alone limits the source's technical freshness window.
    const sourceExpiry = result.sources
      .map((source) => source.expiresAt)
      .filter((value): value is string => value !== undefined)
      .map(Date.parse)
      .reduce((earliest, value) => Math.min(earliest, value), Number.POSITIVE_INFINITY);
    const expiresAt = Math.min(
      now + policy.freshForMs + policy.staleWhileRevalidateForMs,
      sourceExpiry,
    );
    if (expiresAt <= now) return undefined;
    const staleAt = Math.min(now + policy.freshForMs, expiresAt);
    return {
      cache,
      cachedAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      policyKey: policy.key,
      policyVersion: policy.version,
      revalidating,
      staleAt: new Date(staleAt).toISOString(),
      state: "fresh",
    };
  }

  private async writeCache(
    adapter: TravelDataAdapter<TInput, TValue>,
    input: TInput,
    context: TravelDataRequestContext,
    result: ProviderSuccess<TValue>,
    freshness: TravelDataFreshness,
    requestId: string,
  ) {
    const policy = this.operation.cachePolicy;
    if (!this.cache || policy.mode === "none") return;
    const defaultPermission =
      policy.mode === "ephemeral" || result.sources.every((source) => source.redistributionAllowed);
    if (!(this.operation.canCache?.(result) ?? defaultPermission)) return;

    const key = await this.cacheKey(adapter, input, context);
    await this.cache.set(key, {
      cachedAt: freshness.cachedAt,
      expiresAt: freshness.expiresAt,
      policyKey: freshness.policyKey,
      policyVersion: freshness.policyVersion,
      result,
      staleAt: freshness.staleAt,
    });
    await this.emit({
      event: "cache",
      cacheOutcome: "write",
      provider: adapter.provider,
      requestId,
    });
  }

  private scheduleRevalidation(
    adapter: TravelDataAdapter<TInput, TValue>,
    key: string,
    input: TInput,
    context: TravelDataRequestContext,
    requestId: string,
  ) {
    if (this.inFlight.has(key)) return;
    const revalidation = this.fetchProvider(adapter, input, context, requestId)
      .then(async (result) => {
        if (result.status !== "success") {
          await this.emit({
            errorCode: result.status === "error" ? result.error.code : undefined,
            event: "revalidation_failed",
            provider: adapter.provider,
            requestId,
            resultStatus: result.status,
          });
        }
        return result;
      })
      .catch(async () => {
        const failure = this.decorateFailure(
          providerError(
            adapter.provider,
            adapter.operation,
            "internal",
            "Provider revalidation failed unexpectedly.",
            true,
          ),
          requestId,
          0,
        );
        await this.emit({
          errorCode: "internal",
          event: "revalidation_failed",
          provider: adapter.provider,
          requestId,
          resultStatus: "error",
        });
        return failure;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, revalidation);
  }

  private singleFlight(key: string, execute: () => Promise<TravelDataResult<TValue>>) {
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const running = execute().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, running);
    return running;
  }

  private toProviderSuccess(
    result: TravelDataStale<TValue> | TravelDataSuccess<TValue>,
  ): ProviderSuccess<TValue> {
    return {
      operation: result.operation,
      provider: result.provider,
      sources: result.sources,
      status: "success",
      usage: result.usage,
      value: result.value,
      warnings: result.warnings,
    };
  }

  private async emit(
    event: Omit<TravelDataTelemetryEvent, "dataClass" | "operation" | "timestamp">,
  ) {
    try {
      await this.telemetry?.({
        ...event,
        dataClass: this.operation.dataClass,
        operation: this.operation.name,
        timestamp: this.clock().toISOString(),
      });
    } catch {
      // Telemetry must not change provider outcomes. Sinks own their delivery failures.
    }
  }

  private assertAdapter(
    operation: TravelDataOperation<TInput, TValue>,
    adapter: TravelDataAdapter<TInput, TValue>,
  ) {
    if (adapter.operation !== operation.name || adapter.dataClass !== operation.dataClass) {
      throw new Error(
        `Adapter ${adapter.provider} does not implement ${operation.dataClass}:${operation.name}.`,
      );
    }
  }
}
