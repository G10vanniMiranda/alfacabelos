import { createHash, randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 8;
const ADMIN_SESSION_TABLE_ERROR = "Sessao admin indisponivel. Execute as migrations do banco.";

let adminSessionTableChecked = false;
let adminSessionTableExists = false;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createRawToken(): string {
  return randomBytes(32).toString("hex");
}

function isTableMissingError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybe = error as { code?: string; message?: string };
  if (maybe.code === "P2021") {
    return true;
  }

  return typeof maybe.message === "string" && maybe.message.includes("AdminSession") && maybe.message.includes("does not exist");
}

async function ensureAdminSessionTableExists(): Promise<boolean> {
  if (adminSessionTableChecked) {
    return adminSessionTableExists;
  }

  try {
    const result = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND lower(table_name) = lower('AdminSession')
      ) AS "exists"
    `;
    adminSessionTableExists = result[0]?.exists === true;
  } catch {
    adminSessionTableExists = false;
  } finally {
    adminSessionTableChecked = true;
  }

  return adminSessionTableExists;
}

export async function createAdminSession(input: { email: string; adminAccessId?: string | null }) {
  const hasTable = await ensureAdminSessionTableExists();
  if (!hasTable) {
    throw new Error(ADMIN_SESSION_TABLE_ERROR);
  }

  const token = createRawToken();
  const tokenHash = hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ADMIN_SESSION_TTL_SECONDS * 1000);
  const sessionId = randomUUID();

  try {
    await prisma.$executeRaw`
      INSERT INTO "AdminSession" ("id", "tokenHash", "adminAccessId", "email", "expiresAt", "createdAt", "lastSeenAt")
      VALUES (${sessionId}, ${tokenHash}, ${input.adminAccessId ?? null}, ${input.email}, ${expiresAt}, ${now}, ${now})
    `;
  } catch (error) {
    if (isTableMissingError(error)) {
      adminSessionTableExists = false;
      throw new Error(ADMIN_SESSION_TABLE_ERROR);
    }
    throw error;
  }

  return {
    token,
    maxAgeSeconds: ADMIN_SESSION_TTL_SECONDS,
  };
}

export async function isAdminSessionTokenValid(token: string): Promise<boolean> {
  if (!token) {
    return false;
  }

  const hasTable = await ensureAdminSessionTableExists();
  if (!hasTable) {
    return false;
  }

  const tokenHash = hashToken(token);
  const now = new Date();
  const nextExpiresAt = new Date(now.getTime() + ADMIN_SESSION_TTL_SECONDS * 1000);

  try {
    await prisma.$executeRaw`
      DELETE FROM "AdminSession"
      WHERE "expiresAt" <= ${now}
    `;

    const updated = await prisma.$executeRaw`
      UPDATE "AdminSession"
      SET "lastSeenAt" = ${now}, "expiresAt" = ${nextExpiresAt}
      WHERE "tokenHash" = ${tokenHash}
        AND "expiresAt" > ${now}
    `;

    return updated > 0;
  } catch (error) {
    if (isTableMissingError(error)) {
      adminSessionTableExists = false;
      return false;
    }
    throw error;
  }
}

export async function revokeAdminSession(token: string): Promise<void> {
  if (!token) {
    return;
  }

  const hasTable = await ensureAdminSessionTableExists();
  if (!hasTable) {
    return;
  }

  const tokenHash = hashToken(token);
  try {
    await prisma.$executeRaw`
      DELETE FROM "AdminSession"
      WHERE "tokenHash" = ${tokenHash}
    `;
  } catch (error) {
    if (isTableMissingError(error)) {
      adminSessionTableExists = false;
      return;
    }
    throw error;
  }
}
