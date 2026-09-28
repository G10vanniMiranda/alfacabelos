import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isWhatsAppConfigured } from "@/lib/whatsapp";
import { getOperationalNotificationMetrics } from "@/lib/observability/metrics";
import { isSafeAlertWebhookUrl } from "@/lib/observability/alert-delivery";

export type ServiceHealth = "healthy" | "degraded" | "unhealthy" | "disabled" | "unknown";
type RuntimeEnvironment = Partial<NodeJS.ProcessEnv>;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("health_check_timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function checkDatabaseHealth(
  query: () => Promise<unknown> = () => prisma.$queryRaw`SELECT 1`,
  timeoutMs = 1_000,
): Promise<{ status: "healthy" | "unhealthy"; latencyMs: number | null; errorCode?: string }> {
  const startedAt = Date.now();
  try {
    await withTimeout(query(), timeoutMs);
    return { status: "healthy", latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      status: "unhealthy",
      latencyMs: error instanceof Error && error.message === "health_check_timeout" ? timeoutMs : null,
      errorCode: error instanceof Error && error.message === "health_check_timeout" ? "timeout" : "unavailable",
    };
  }
}

export async function checkSchemaReadiness(): Promise<{ status: "healthy" | "unhealthy"; compatible: boolean }> {
  try {
    const rows = await prisma.$queryRaw<Array<{ audit: string | null; heartbeat: string | null; notificationColumn: boolean }>>(Prisma.sql`
      SELECT
        to_regclass('public."AuditLog"')::text AS "audit",
        to_regclass('public."OperationalHeartbeat"')::text AS "heartbeat",
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'NotificationDelivery' AND column_name = 'requestId'
        ) AS "notificationColumn"
    `);
    const compatible = Boolean(rows[0]?.audit && rows[0]?.heartbeat && rows[0]?.notificationColumn);
    return { status: compatible ? "healthy" : "unhealthy", compatible };
  } catch {
    return { status: "unhealthy", compatible: false };
  }
}

function isHttpsUrl(value: string | undefined): boolean {
  try {
    return new URL(value ?? "").protocol === "https:";
  } catch {
    return false;
  }
}

function databaseMatchesSupabaseRef(value: string | undefined, projectRef: string): boolean {
  try {
    const url = new URL(value ?? "");
    return url.hostname === `db.${projectRef}.supabase.co`
      || url.hostname.includes(projectRef)
      || decodeURIComponent(url.username).endsWith(`.${projectRef}`);
  } catch {
    return false;
  }
}

function supabaseUrlMatchesProjectRef(value: string | undefined, projectRef: string): boolean {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" && url.hostname === `${projectRef}.supabase.co`;
  } catch {
    return false;
  }
}

function normalizedHost(value: string | undefined): string | null {
  const candidate = value?.trim().toLowerCase();
  if (!candidate) return null;
  try {
    return new URL(candidate.includes("://") ? candidate : `https://${candidate}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function checkCriticalConfiguration(env: RuntimeEnvironment = process.env): { status: "healthy" | "unhealthy"; issues: string[] } {
  const issues: string[] = [];
  const appEnv = env.APP_ENV?.trim().toLowerCase();
  const vercelEnv = env.VERCEL_ENV?.trim().toLowerCase();
  const strictRuntime = appEnv === "production" || appEnv === "homologation" || vercelEnv === "production" || vercelEnv === "preview";
  const applicationUrl = env.APP_URL || env.NEXT_PUBLIC_APP_URL || (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : undefined);

  if (!env.DATABASE_URL) issues.push("database");
  if (!applicationUrl) issues.push("application_url");
  if (!env.CRON_SECRET || env.CRON_SECRET.trim().length < 16) issues.push("notification_worker_auth");
  if (env.WHATSAPP_ENABLED === "true") {
    if (!(env.WHATSAPP_PROVIDER?.trim() && env.WHATSAPP_API_URL?.trim() && env.WHATSAPP_API_TOKEN?.trim())) {
      issues.push("whatsapp_provider");
    }
    if (env.WHATSAPP_PROVIDER?.trim().toLowerCase() === "evolution"
      && env.WHATSAPP_API_URL?.includes("{instanceId}")
      && !env.WHATSAPP_INSTANCE_ID?.trim()) {
      issues.push("whatsapp_instance");
    }
  }

  if (strictRuntime) {
    if (appEnv !== "production" && appEnv !== "homologation") issues.push("application_environment");
    if (applicationUrl && !isHttpsUrl(applicationUrl)) issues.push("application_url_security");
    if (!env.DIRECT_URL) issues.push("database_direct");
    if (!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_STORAGE_BUCKET)) issues.push("supabase_configuration");
    const projectRef = env.SUPABASE_PROJECT_REF?.trim().toLowerCase();
    const supabaseMatches = Boolean(projectRef)
      && supabaseUrlMatchesProjectRef(env.SUPABASE_URL, projectRef as string)
      && databaseMatchesSupabaseRef(env.DATABASE_URL, projectRef as string)
      && databaseMatchesSupabaseRef(env.DIRECT_URL, projectRef as string);
    if (!supabaseMatches) issues.push("supabase_identity");
    if (!isSafeAlertWebhookUrl(env.ALERT_WEBHOOK_URL)) issues.push("alert_receiver");

    if (appEnv === "homologation") {
      const productionProjectRef = env.PRODUCTION_SUPABASE_PROJECT_REF?.trim().toLowerCase();
      const productionAppHost = normalizedHost(env.PRODUCTION_APP_HOST);
      const productionStorageBucket = env.PRODUCTION_STORAGE_BUCKET?.trim().toLowerCase();
      if (!(productionProjectRef && productionAppHost && productionStorageBucket)) {
        issues.push("production_identity_baseline");
      } else {
        if (projectRef === productionProjectRef) issues.push("production_supabase_reference");
        if ([env.DATABASE_URL, env.DIRECT_URL].some((value) => databaseMatchesSupabaseRef(value, productionProjectRef))) {
          issues.push("production_database");
        }
        if (env.SUPABASE_STORAGE_BUCKET?.trim().toLowerCase() === productionStorageBucket) issues.push("production_storage");
        if (normalizedHost(applicationUrl) === productionAppHost) issues.push("production_application");
      }

      if (env.WHATSAPP_ENABLED === "true") {
        const productionInstanceId = env.PRODUCTION_EVOLUTION_INSTANCE_ID?.trim();
        if (!productionInstanceId) issues.push("production_evolution_baseline");
        else if (env.WHATSAPP_INSTANCE_ID?.trim() === productionInstanceId) issues.push("production_evolution_instance");
      }
    }
  }
  return { status: issues.length ? "unhealthy" : "healthy", issues };
}

export async function recordWorkerHeartbeat(input: {
  worker: string;
  status: "running" | "success" | "failure";
  durationMs?: number;
  processedCount?: number;
  errorCode?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  const now = new Date();
  await prisma.operationalHeartbeat.upsert({
    where: { worker: input.worker },
    create: {
      worker: input.worker, status: input.status, lastRunAt: now,
      lastSuccessAt: input.status === "success" ? now : null,
      lastFailureAt: input.status === "failure" ? now : null,
      durationMs: input.durationMs, processedCount: input.processedCount ?? 0,
      lastErrorCode: input.errorCode, metadata: input.metadata,
    },
    update: {
      status: input.status, lastRunAt: now,
      ...(input.status === "success" ? { lastSuccessAt: now } : {}),
      ...(input.status === "failure" ? { lastFailureAt: now } : {}),
      durationMs: input.durationMs, processedCount: input.processedCount ?? 0,
      lastErrorCode: input.errorCode ?? null, metadata: input.metadata,
    },
  });
}

export function classifyWorkerHeartbeat(
  heartbeat: { lastSuccessAt: Date | null; lastFailureAt: Date | null; status: string } | null,
  now = new Date(),
  staleAfterSeconds = Number(process.env.ALERT_WORKER_STALE_SECONDS ?? 15 * 60),
) {
  if (!heartbeat?.lastSuccessAt) return { status: "unknown" as const, ageSeconds: null };
  const ageSeconds = Math.max(0, Math.floor((now.getTime() - heartbeat.lastSuccessAt.getTime()) / 1000));
  if (ageSeconds > staleAfterSeconds) return { status: "unhealthy" as const, ageSeconds };
  if (heartbeat.status === "failure" || heartbeat.lastFailureAt && heartbeat.lastFailureAt > heartbeat.lastSuccessAt) {
    return { status: "degraded" as const, ageSeconds };
  }
  return { status: "healthy" as const, ageSeconds };
}

export async function getWorkerHealth(now = new Date()) {
  const heartbeat = await prisma.operationalHeartbeat.findUnique({ where: { worker: "notification-outbox" } });
  return { ...classifyWorkerHeartbeat(heartbeat, now), lastRunAt: heartbeat?.lastRunAt.toISOString() ?? null, lastSuccessAt: heartbeat?.lastSuccessAt?.toISOString() ?? null };
}

export async function getWhatsAppHealth(now = new Date()): Promise<{
  status: ServiceHealth;
  lastSuccessAt: string | null;
  retry24h: number;
  dead24h: number;
}> {
  if (process.env.WHATSAPP_ENABLED !== "true") return { status: "disabled", lastSuccessAt: null, retry24h: 0, dead24h: 0 };
  if (!isWhatsAppConfigured()) return { status: "unhealthy", lastSuccessAt: null, retry24h: 0, dead24h: 0 };
  const [metrics, lastSent] = await Promise.all([
    getOperationalNotificationMetrics(now),
    prisma.notificationDelivery.findFirst({ where: { status: "SENT" }, orderBy: { sentAt: "desc" }, select: { sentAt: true } }),
  ]);
  const status: ServiceHealth = metrics.dead24h > 0 ? "unhealthy" : metrics.retry > 0 ? "degraded" : lastSent ? "healthy" : "unknown";
  return { status, lastSuccessAt: lastSent?.sentAt?.toISOString() ?? null, retry24h: metrics.retries24h, dead24h: metrics.dead24h };
}

export function applicationVersion(): string {
  return process.env.APP_VERSION || process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || "unknown";
}
