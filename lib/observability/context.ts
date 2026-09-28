import { randomUUID } from "node:crypto";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;

export function isValidRequestId(value: string | null | undefined): value is string {
  return Boolean(value && REQUEST_ID_PATTERN.test(value));
}

export function createRequestId(platformRequestId?: string | null): string {
  return isValidRequestId(platformRequestId) ? platformRequestId : randomUUID();
}

export function requestIdFromHeaders(headers: Pick<Headers, "get">): string {
  const propagated = headers.get("x-request-id");
  return isValidRequestId(propagated) ? propagated : createRequestId();
}

export function platformRequestId(headers: Pick<Headers, "get">): string {
  const vercelId = process.env.VERCEL ? headers.get("x-vercel-id") : null;
  return createRequestId(vercelId);
}
