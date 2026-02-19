import { prisma } from "@/lib/prisma";
import { randomUUID } from "node:crypto";

const WINDOW_MINUTES = 15;
const MAX_ATTEMPTS = 5;

let tableChecked = false;
let tableExists = false;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isTableMissingError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybe = error as { code?: string; message?: string };
  if (maybe.code === "P2021") {
    return true;
  }
  return typeof maybe.message === "string" && maybe.message.includes("AdminLoginAttempt") && maybe.message.includes("does not exist");
}

async function ensureTableExists(): Promise<boolean> {
  if (tableChecked) {
    return tableExists;
  }

  try {
    const result = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND lower(table_name) = lower('AdminLoginAttempt')
      ) AS "exists"
    `;
    tableExists = result[0]?.exists === true;
  } catch {
    tableExists = false;
  } finally {
    tableChecked = true;
  }

  return tableExists;
}

async function cleanupOldAttempts() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await prisma.$executeRaw`
    DELETE FROM "AdminLoginAttempt"
    WHERE "createdAt" < ${cutoff}
  `;
}

export async function getAdminLoginBlockStatus(email: string): Promise<{ blocked: boolean; retryAfterSeconds: number }> {
  const hasTable = await ensureTableExists();
  if (!hasTable) {
    return { blocked: false, retryAfterSeconds: 0 };
  }

  const normalized = normalizeEmail(email);
  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);

  try {
    await cleanupOldAttempts();

    const rows = await prisma.$queryRaw<Array<{ count: bigint | number | string; firstAttempt: Date | null }>>`
      SELECT COUNT(*)::bigint AS "count", MIN("createdAt") AS "firstAttempt"
      FROM "AdminLoginAttempt"
      WHERE "email" = ${normalized}
        AND "createdAt" >= ${windowStart}
    `;

    const countRaw = rows[0]?.count ?? 0;
    const count = typeof countRaw === "bigint" ? Number(countRaw) : Number(countRaw);
    const firstAttempt = rows[0]?.firstAttempt;

    if (count >= MAX_ATTEMPTS && firstAttempt) {
      const unlockAt = new Date(firstAttempt.getTime() + WINDOW_MINUTES * 60 * 1000);
      const retryAfterSeconds = Math.max(1, Math.ceil((unlockAt.getTime() - Date.now()) / 1000));
      return { blocked: retryAfterSeconds > 0, retryAfterSeconds };
    }

    return { blocked: false, retryAfterSeconds: 0 };
  } catch (error) {
    if (isTableMissingError(error)) {
      tableExists = false;
      return { blocked: false, retryAfterSeconds: 0 };
    }
    throw error;
  }
}

export async function registerFailedAdminLogin(email: string): Promise<void> {
  const hasTable = await ensureTableExists();
  if (!hasTable) {
    return;
  }

  const normalized = normalizeEmail(email);

  try {
    await prisma.$executeRaw`
      INSERT INTO "AdminLoginAttempt" ("id", "email", "createdAt")
      VALUES (${randomUUID()}, ${normalized}, ${new Date()})
    `;
  } catch (error) {
    if (isTableMissingError(error)) {
      tableExists = false;
      return;
    }
    throw error;
  }
}

export async function clearAdminLoginAttempts(email: string): Promise<void> {
  const hasTable = await ensureTableExists();
  if (!hasTable) {
    return;
  }

  const normalized = normalizeEmail(email);
  try {
    await prisma.$executeRaw`
      DELETE FROM "AdminLoginAttempt"
      WHERE "email" = ${normalized}
    `;
  } catch (error) {
    if (isTableMissingError(error)) {
      tableExists = false;
      return;
    }
    throw error;
  }
}
