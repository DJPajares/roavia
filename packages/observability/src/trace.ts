import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const traceparentPattern = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export interface TraceContext {
  traceId: string;
  traceparent: string;
}

function nonZeroHex(bytes: number) {
  let value = randomBytes(bytes).toString("hex");
  if (/^0+$/.test(value)) value = `${"0".repeat(value.length - 1)}1`;
  return value;
}

export function createTraceContext(incomingTraceparent?: string): TraceContext {
  const match = incomingTraceparent?.trim().toLowerCase().match(traceparentPattern);
  const traceId = match && !/^0+$/.test(match[1]!) ? match[1]! : nonZeroHex(16);
  const flags = match?.[3] ?? "01";
  return {
    traceId,
    traceparent: `00-${traceId}-${nonZeroHex(8)}-${flags}`,
  };
}

export function authorizeMetricsRequest(authorization: string | undefined, token: string) {
  const candidate = authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!candidate || token.length < 32 || candidate.length !== token.length) return false;
  const expectedDigest = createHash("sha256").update(token).digest();
  const candidateDigest = createHash("sha256").update(candidate).digest();
  return timingSafeEqual(expectedDigest, candidateDigest);
}
