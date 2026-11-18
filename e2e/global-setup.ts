import type { FullConfig } from "@playwright/test";

// The CI E2E run uses the dev server, which compiles each route on its first request. On a busy
// runner that first compile can exceed a test's 30 s budget (WebKit page loads timed out). Compile
// the routes once, before any test, so tests measure the app and not the compiler.
const ROUTES = [
  "/", "/agendar", "/cliente", "/cliente/login", "/cliente/cadastro", "/esqueci-minha-senha", "/redefinir-senha",
  "/admin", "/admin/dashboard", "/admin/agenda", "/barbeiro/agenda",
  "/api/health", "/api/services", "/api/barbers", "/api/available-slots?date=2037-01-05&serviceId=warmup",
  "/api/admin/alerts", "/api/client/bookings",
];

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) return;
  for (const route of ROUTES) {
    await fetch(new URL(route, baseURL), { redirect: "manual", signal: AbortSignal.timeout(180_000) }).catch(() => undefined);
  }
}
