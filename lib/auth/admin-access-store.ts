import { prisma } from "@/lib/prisma";
import { AdminAccessUser } from "@/types/domain";
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const ADMIN_ACCESS_TABLE_ERROR = "Acesso admin indisponivel. Execute as migrations do banco.";

type AdminAccessRow = {
  id: string;
  email: string;
  passwordHash: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
};

let adminAccessTableChecked = false;
let adminAccessTableExists = false;

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

  return typeof maybe.message === "string" && maybe.message.includes("AdminAccess") && maybe.message.includes("does not exist");
}

async function ensureAdminAccessTableExists(): Promise<boolean> {
  if (adminAccessTableChecked) {
    return adminAccessTableExists;
  }

  try {
    const result = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND lower(table_name) = lower('AdminAccess')
      ) AS "exists"
    `;
    adminAccessTableExists = result[0]?.exists === true;
  } catch {
    adminAccessTableExists = false;
  } finally {
    adminAccessTableChecked = true;
  }

  return adminAccessTableExists;
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) {
    return false;
  }

  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const hashBuffer = Buffer.from(hash, "hex");
  if (hashBuffer.length !== derived.length) {
    return false;
  }

  return timingSafeEqual(hashBuffer, derived);
}

function toAdminAccessUser(row: Omit<AdminAccessRow, "passwordHash">): AdminAccessUser {
  return {
    id: row.id,
    email: row.email,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : undefined,
  };
}

function stripPasswordHash(row: AdminAccessRow): Omit<AdminAccessRow, "passwordHash"> {
  return {
    id: row.id,
    email: row.email,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastLoginAt: row.lastLoginAt,
  };
}

async function listAdminAccessRows(): Promise<AdminAccessRow[]> {
  return prisma.$queryRaw<AdminAccessRow[]>`
    SELECT "id", "email", "passwordHash", "isActive", "createdAt", "updatedAt", "lastLoginAt"
    FROM "AdminAccess"
    WHERE "isActive" = true
    ORDER BY "createdAt" ASC
  `;
}

export async function listAdminAccesses(): Promise<AdminAccessUser[]> {
  const hasTable = await ensureAdminAccessTableExists();
  if (!hasTable) {
    throw new Error(ADMIN_ACCESS_TABLE_ERROR);
  }

  try {
    const rows = await listAdminAccessRows();
    return rows.map((row) => toAdminAccessUser(stripPasswordHash(row)));
  } catch (error) {
    if (isTableMissingError(error)) {
      adminAccessTableExists = false;
      throw new Error(ADMIN_ACCESS_TABLE_ERROR);
    }
    throw error;
  }
}

export async function createAdminAccess(input: { email: string; password: string }): Promise<AdminAccessUser> {
  const hasTable = await ensureAdminAccessTableExists();
  if (!hasTable) {
    throw new Error(ADMIN_ACCESS_TABLE_ERROR);
  }

  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);

  try {
    const existing = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "AdminAccess"
      WHERE "email" = ${email} AND "isActive" = true
      LIMIT 1
    `;

    if (existing.length > 0) {
      throw new Error("Ja existe um acesso admin com este email");
    }

    const id = randomUUID();
    const now = new Date();

    await prisma.$executeRaw`
      INSERT INTO "AdminAccess" ("id", "email", "passwordHash", "isActive", "createdAt", "updatedAt")
      VALUES (${id}, ${email}, ${passwordHash}, true, ${now}, ${now})
    `;

    const rows = await prisma.$queryRaw<AdminAccessRow[]>`
      SELECT "id", "email", "passwordHash", "isActive", "createdAt", "updatedAt", "lastLoginAt"
      FROM "AdminAccess"
      WHERE "id" = ${id}
      LIMIT 1
    `;

    const created = rows[0];
    if (!created) {
      throw new Error("Falha ao criar acesso admin");
    }

    return toAdminAccessUser(stripPasswordHash(created));
  } catch (error) {
    if (error instanceof Error && error.message === "Ja existe um acesso admin com este email") {
      throw error;
    }

    if (isTableMissingError(error)) {
      adminAccessTableExists = false;
      throw new Error(ADMIN_ACCESS_TABLE_ERROR);
    }

    throw error;
  }
}

export async function deleteAdminAccess(accessId: string): Promise<boolean> {
  const hasTable = await ensureAdminAccessTableExists();
  if (!hasTable) {
    throw new Error(ADMIN_ACCESS_TABLE_ERROR);
  }

  try {
    const deletedCount = await prisma.$executeRaw`
      DELETE FROM "AdminAccess"
      WHERE "id" = ${accessId} AND "isActive" = true
    `;

    return deletedCount > 0;
  } catch (error) {
    if (isTableMissingError(error)) {
      adminAccessTableExists = false;
      throw new Error(ADMIN_ACCESS_TABLE_ERROR);
    }
    throw error;
  }
}

export async function countAdminAccesses(): Promise<number> {
  const hasTable = await ensureAdminAccessTableExists();
  if (!hasTable) {
    return 0;
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ count: bigint | number | string }>>`
      SELECT COUNT(*)::bigint AS "count"
      FROM "AdminAccess"
      WHERE "isActive" = true
    `;

    const value = rows[0]?.count;
    if (typeof value === "bigint") {
      return Number(value);
    }
    if (typeof value === "number") {
      return value;
    }

    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch (error) {
    if (isTableMissingError(error)) {
      adminAccessTableExists = false;
      return 0;
    }
    throw error;
  }
}

export async function authenticateAdminAccess(email: string, password: string): Promise<AdminAccessUser | null> {
  const hasTable = await ensureAdminAccessTableExists();
  if (!hasTable) {
    return null;
  }

  try {
    const rows = await prisma.$queryRaw<AdminAccessRow[]>`
      SELECT "id", "email", "passwordHash", "isActive", "createdAt", "updatedAt", "lastLoginAt"
      FROM "AdminAccess"
      WHERE "email" = ${normalizeEmail(email)}
        AND "isActive" = true
      LIMIT 1
    `;

    const found = rows[0];
    if (!found) {
      return null;
    }

    const passwordOk = await verifyPassword(password, found.passwordHash);
    if (!passwordOk) {
      return null;
    }

    return toAdminAccessUser(stripPasswordHash(found));
  } catch (error) {
    if (isTableMissingError(error)) {
      adminAccessTableExists = false;
      return null;
    }
    throw error;
  }
}

export async function registerAdminLogin(accessId: string): Promise<void> {
  const hasTable = await ensureAdminAccessTableExists();
  if (!hasTable) {
    return;
  }

  try {
    const now = new Date();
    await prisma.$executeRaw`
      UPDATE "AdminAccess"
      SET "lastLoginAt" = ${now}, "updatedAt" = ${now}
      WHERE "id" = ${accessId}
    `;
  } catch (error) {
    if (isTableMissingError(error)) {
      adminAccessTableExists = false;
      return;
    }
    throw error;
  }
}
