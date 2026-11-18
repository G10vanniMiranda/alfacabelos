// Connection-level Prisma failures: unreachable, timed out, connection dropped, pool exhausted.
const UNAVAILABLE_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);
const UNAVAILABLE_MESSAGE = /Can't reach database server|Server has closed the connection|Timed out fetching a new connection|Connection terminated/i;

export function isDatabaseUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; message?: string };
  return Boolean(candidate.code && UNAVAILABLE_CODES.has(candidate.code)) || UNAVAILABLE_MESSAGE.test(candidate.message ?? "");
}

export function safeActionErrorMessage(error: unknown, fallback: string): string {
  if (isDatabaseUnavailableError(error)) {
    return "O sistema está temporariamente indisponível. Tente novamente em alguns instantes.";
  }
  if (!(error instanceof Error)) return fallback;
  if (error.name.startsWith("Prisma") || /^Invalid `prisma\./.test(error.message)) return fallback;
  return error.message || fallback;
}
