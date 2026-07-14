function normalize(value: string | undefined): string | null {
  const url = value?.trim();
  if (!url) return null;
  return url.replace(/\/$/, "");
}

export function getAppUrl(): string | null {
  return normalize(process.env.APP_URL)
    ?? normalize(process.env.NEXT_PUBLIC_APP_URL)
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
    ?? (process.env.NODE_ENV === "production" ? null : normalize(process.env.TEST_BASE_URL) ?? "http://localhost:3000");
}

export function buildAppUrl(pathname: string): string | null {
  const base = getAppUrl();
  if (!base) return null;
  return `${base}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}
