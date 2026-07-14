export function getSafeInternalPath(value: string | null | undefined, fallback = "/cliente"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return fallback;
  }

  try {
    const parsed = new URL(value, "https://internal.invalid");
    if (parsed.origin !== "https://internal.invalid") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function getSafeStaffPath(value: string | null | undefined, role: "ADMIN" | "BARBER"): string {
  const fallback = role === "ADMIN" ? "/admin/dashboard" : "/barbeiro/agenda";
  const safe = getSafeInternalPath(value, fallback);
  const allowedPrefix = role === "ADMIN" ? "/admin/" : "/barbeiro/";
  return safe.startsWith(allowedPrefix) ? safe : fallback;
}
