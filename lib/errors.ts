export function isDatabaseUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; message?: string };
  return candidate.code === "P1001" || Boolean(candidate.message?.includes("Can't reach database server"));
}

export function safeActionErrorMessage(error: unknown, fallback: string): string {
  if (isDatabaseUnavailableError(error)) {
    return "O sistema está temporariamente indisponível. Tente novamente em alguns instantes.";
  }
  if (!(error instanceof Error)) return fallback;
  if (error.name.startsWith("Prisma") || /^Invalid `prisma\./.test(error.message)) return fallback;
  return error.message || fallback;
}
