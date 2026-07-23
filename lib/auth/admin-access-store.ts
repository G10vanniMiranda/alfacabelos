import { prisma } from "@/lib/prisma";
import { AccessRole, AdminAccessUser } from "@/types/domain";
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { isDatabaseUnavailableError } from "@/lib/errors";
import { Prisma } from "@prisma/client";

const scrypt = promisify(scryptCallback);
const ADMIN_ACCESS_TABLE_ERROR = "Acesso administrativo indisponível. Execute as migrações do banco.";

type AdminAccessRow = {
  id: string;
  email: string;
  passwordHash: string;
  isActive: boolean;
  role: AccessRole;
  barberId: string | null;
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
  } catch (error) {
    if (isDatabaseUnavailableError(error)) throw error;
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
    role: row.role,
    barberId: row.barberId ?? undefined,
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
    role: row.role,
    barberId: row.barberId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastLoginAt: row.lastLoginAt,
  };
}

async function listAdminAccessRows(): Promise<AdminAccessRow[]> {
  return prisma.$queryRaw<AdminAccessRow[]>`
    SELECT "id", "email", "passwordHash", "isActive", "role"::text AS "role", "barberId", "createdAt", "updatedAt", "lastLoginAt"
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

export async function createAdminAccess(input: {
  email: string;
  password: string;
  role?: AccessRole;
  barberId?: string | null;
}): Promise<AdminAccessUser> {
  const hasTable = await ensureAdminAccessTableExists();
  if (!hasTable) {
    throw new Error(ADMIN_ACCESS_TABLE_ERROR);
  }

  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);
  const role = input.role ?? "ADMIN";
  const barberId = role === "BARBER" ? input.barberId ?? null : null;
  if (role === "BARBER" && !barberId) throw new Error("Selecione o barbeiro vinculado");

  try {
    const existing = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "AdminAccess"
      WHERE "email" = ${email} AND "isActive" = true
      LIMIT 1
    `;

    if (existing.length > 0) {
      throw new Error("Já existe um acesso administrativo com este e-mail");
    }

    const id = randomUUID();
    const now = new Date();

    await prisma.$executeRaw`
      INSERT INTO "AdminAccess" ("id", "email", "passwordHash", "isActive", "role", "barberId", "createdAt", "updatedAt")
      VALUES (${id}, ${email}, ${passwordHash}, true, CAST(${role} AS "AccessRole"), ${barberId}, ${now}, ${now})
    `;

    const rows = await prisma.$queryRaw<AdminAccessRow[]>`
      SELECT "id", "email", "passwordHash", "isActive", "role"::text AS "role", "barberId", "createdAt", "updatedAt", "lastLoginAt"
      FROM "AdminAccess"
      WHERE "id" = ${id}
      LIMIT 1
    `;

    const created = rows[0];
    if (!created) {
      throw new Error("Falha ao criar acesso administrativo");
    }

    return toAdminAccessUser(stripPasswordHash(created));
  } catch (error) {
    if (error instanceof Error && error.message === "Já existe um acesso administrativo com este e-mail") {
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
    const deletedCount = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('admin-access-role-guard'))`;
      const target = await tx.$queryRaw<Array<{ role: AccessRole }>>`
        SELECT "role"::text AS "role" FROM "AdminAccess"
        WHERE "id" = ${accessId} AND "isActive" = true
        LIMIT 1
      `;
      if (!target[0]) return 0;
      if (target[0].role === "ADMIN") {
        const admins = await tx.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS "count" FROM "AdminAccess"
          WHERE "isActive" = true AND "role" = 'ADMIN'
        `;
        if (Number(admins[0]?.count ?? 0) <= 1) {
          throw new Error("Mantenha pelo menos um administrador ativo");
        }
      }
      return tx.$executeRaw`
        DELETE FROM "AdminAccess"
        WHERE "id" = ${accessId} AND "isActive" = true
      `;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return deletedCount > 0;
  } catch (error) {
    if (isTableMissingError(error)) {
      adminAccessTableExists = false;
      throw new Error(ADMIN_ACCESS_TABLE_ERROR);
    }
    throw error;
  }
}

export async function updateAdminAccess(input: {
  accessId: string;
  email: string;
  password?: string;
  role?: AccessRole;
  barberId?: string | null;
}): Promise<AdminAccessUser | null> {
  const hasTable = await ensureAdminAccessTableExists();
  if (!hasTable) {
    throw new Error(ADMIN_ACCESS_TABLE_ERROR);
  }

  const email = normalizeEmail(input.email);
  const password = input.password?.trim();
  const role = input.role ?? "ADMIN";
  const barberId = role === "BARBER" ? input.barberId ?? null : null;
  if (role === "BARBER" && !barberId) throw new Error("Selecione o barbeiro vinculado");
  const passwordHash = password ? await hashPassword(password) : null;

  try {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('admin-access-role-guard'))`;
      const current = await tx.$queryRaw<Array<{ role: AccessRole }>>`
        SELECT "role"::text AS "role" FROM "AdminAccess"
        WHERE "id" = ${input.accessId} AND "isActive" = true LIMIT 1
      `;
      if (!current[0]) return [];
      if (current[0].role === "ADMIN" && role !== "ADMIN") {
        const admins = await tx.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS "count" FROM "AdminAccess"
          WHERE "isActive" = true AND "role" = 'ADMIN'
        `;
        if (Number(admins[0]?.count ?? 0) <= 1) {
          throw new Error("Mantenha pelo menos um administrador ativo");
        }
      }
      const existing = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "AdminAccess"
        WHERE "email" = ${email} AND "isActive" = true AND "id" <> ${input.accessId}
        LIMIT 1
      `;
      if (existing.length > 0) throw new Error("Já existe um acesso administrativo com este e-mail");
      const now = new Date();
      if (passwordHash) {
        await tx.$executeRaw`
          UPDATE "AdminAccess" SET "email" = ${email}, "passwordHash" = ${passwordHash},
            "role" = CAST(${role} AS "AccessRole"), "barberId" = ${barberId}, "updatedAt" = ${now}
          WHERE "id" = ${input.accessId} AND "isActive" = true
        `;
      } else {
        await tx.$executeRaw`
          UPDATE "AdminAccess" SET "email" = ${email}, "role" = CAST(${role} AS "AccessRole"),
            "barberId" = ${barberId}, "updatedAt" = ${now}
          WHERE "id" = ${input.accessId} AND "isActive" = true
        `;
      }
      return tx.$queryRaw<AdminAccessRow[]>`
        SELECT "id", "email", "passwordHash", "isActive", "role"::text AS "role", "barberId", "createdAt", "updatedAt", "lastLoginAt"
        FROM "AdminAccess" WHERE "id" = ${input.accessId} AND "isActive" = true LIMIT 1
      `;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const updated = rows[0];
    return updated ? toAdminAccessUser(stripPasswordHash(updated)) : null;
  } catch (error) {
    if (error instanceof Error && error.message === "Já existe um acesso administrativo com este e-mail") {
      throw error;
    }

    if (isTableMissingError(error)) {
      adminAccessTableExists = false;
      throw new Error(ADMIN_ACCESS_TABLE_ERROR);
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
      SELECT "id", "email", "passwordHash", "isActive", "role"::text AS "role", "barberId", "createdAt", "updatedAt", "lastLoginAt"
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
