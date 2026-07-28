import type { ProviderCircuitBreakerPolicy, ProviderRetryPolicy } from "./contracts.js";

interface CircuitState {
  failures: number;
  halfOpenInFlight: boolean;
  openedAt?: number;
}

export interface CircuitPermit {
  allowed: boolean;
  halfOpen: boolean;
  retryAfterMs?: number;
}

export interface ProviderCircuitBreaker {
  acquire(key: string, policy: ProviderCircuitBreakerPolicy, now: number): CircuitPermit;
  recordFailure(key: string, policy: ProviderCircuitBreakerPolicy, now: number): boolean;
  recordSuccess(key: string): void;
}

/** In-memory state contract; distributed runtimes can replace it at composition time. */
export class MemoryProviderCircuitBreaker implements ProviderCircuitBreaker {
  private readonly states = new Map<string, CircuitState>();

  acquire(key: string, policy: ProviderCircuitBreakerPolicy, now: number): CircuitPermit {
    const state = this.states.get(key);
    if (state?.openedAt === undefined) return { allowed: true, halfOpen: false };

    const elapsed = now - state.openedAt;
    if (elapsed < policy.openForMs) {
      return { allowed: false, halfOpen: false, retryAfterMs: policy.openForMs - elapsed };
    }
    if (state.halfOpenInFlight) {
      return { allowed: false, halfOpen: true, retryAfterMs: policy.openForMs };
    }

    state.halfOpenInFlight = true;
    return { allowed: true, halfOpen: true };
  }

  recordFailure(key: string, policy: ProviderCircuitBreakerPolicy, now: number) {
    const state = this.states.get(key) ?? { failures: 0, halfOpenInFlight: false };
    state.failures += 1;
    state.halfOpenInFlight = false;
    if (state.openedAt !== undefined || state.failures >= policy.failureThreshold) {
      state.openedAt = now;
    }
    this.states.set(key, state);
    return state.openedAt !== undefined;
  }

  recordSuccess(key: string) {
    this.states.delete(key);
  }

  snapshot(key: string) {
    const state = this.states.get(key);
    return state ? { ...state } : undefined;
  }
}

export function calculateRetryDelay(
  policy: ProviderRetryPolicy,
  completedAttempt: number,
  jitter: () => number,
  retryAfterMs?: number,
) {
  const exponential = Math.min(
    policy.maxDelayMs,
    policy.initialDelayMs * policy.backoffFactor ** Math.max(0, completedAttempt - 1),
  );
  const randomized = exponential + exponential * policy.jitterRatio * (jitter() * 2 - 1);
  return Math.min(
    policy.maxDelayMs,
    Math.max(retryAfterMs ?? 0, Math.max(0, Math.round(randomized))),
  );
}

export function sleepWithSignal(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }

    const complete = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timeout = setTimeout(complete, ms);
    const abort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export function validateExecutionPolicy(input: {
  circuitBreaker: ProviderCircuitBreakerPolicy;
  retry: ProviderRetryPolicy;
  timeoutMs: number;
}) {
  const { circuitBreaker, retry, timeoutMs } = input;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("Provider timeoutMs must be a positive integer.");
  }
  if (!Number.isInteger(circuitBreaker.failureThreshold) || circuitBreaker.failureThreshold < 1) {
    throw new Error("Circuit failureThreshold must be a positive integer.");
  }
  if (!Number.isInteger(circuitBreaker.openForMs) || circuitBreaker.openForMs < 1) {
    throw new Error("Circuit openForMs must be a positive integer.");
  }
  if (!Number.isInteger(retry.maxAttempts) || retry.maxAttempts < 1) {
    throw new Error("Retry maxAttempts must be a positive integer.");
  }
  if (retry.backoffFactor < 1 || retry.initialDelayMs < 0 || retry.maxDelayMs < 1) {
    throw new Error("Retry delays and backoff factor are invalid.");
  }
  if (retry.maxDelayMs < retry.initialDelayMs || retry.jitterRatio < 0 || retry.jitterRatio > 1) {
    throw new Error("Retry max delay or jitter ratio is invalid.");
  }
}
