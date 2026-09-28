import { ClientUser } from "@/types/domain";
import { prisma } from "@/lib/prisma";
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { getBrazilPhoneLookupCandidates, normalizeBrazilPhoneNational } from "@/lib/phone";

const scrypt = promisify(scryptCallback);
const CLIENT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const CLIENT_SESSION_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

export function normalizeClientPhone(phone: string): string {
  return normalizeBrazilPhoneNational(phone) ?? phone.replace(/\D/g, "");
}

async function findClientRecordByPhone(phone: string) {
  for (const candidate of getBrazilPhoneLookupCandidates(phone)) {
    const client = await prisma.client.findUnique({ where: { phoneNormalized: candidate } });
    if (client) return client;
  }
  return null;
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createRawSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export async function hashClientPassword(password: string): Promise<string> {
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

function toClientUser(row: {
  id: string;
  name: string;
  phone: string;
  hasPassword?: boolean | null;
  status?: "PENDING" | "ACTIVE" | null;
  createdBy?: "BARBER" | "CLIENT" | null;
  createdAt: Date;
}): ClientUser {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    hasPassword: row.hasPassword ?? true,
    status: row.status ?? "ACTIVE",
    createdBy: row.createdBy ?? "CLIENT",
    createdAt: row.createdAt.toISOString(),
  };
}

export async function findClientByPhone(phone: string): Promise<ClientUser | undefined> {
  const client = await findClientRecordByPhone(phone);
  return client ? toClientUser(client) : undefined;
}

export async function findClientById(id: string): Promise<ClientUser | undefined> {
  const client = await prisma.client.findUnique({
    where: { id },
    select: { id: true, name: true, phone: true, hasPassword: true, status: true, createdBy: true, createdAt: true },
  });
  return client ? toClientUser(client) : undefined;
}

export async function createClientSession(clientId: string): Promise<{ token: string; maxAgeSeconds: number }> {
  const token = createRawSessionToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CLIENT_SESSION_TTL_SECONDS * 1000);

  await prisma.clientSession.deleteMany({ where: { expiresAt: { lte: now } } });

  await prisma.clientSession.create({
    data: {
      tokenHash: hashSessionToken(token),
      clientId,
      expiresAt,
      lastSeenAt: now,
    },
  });

  return {
    token,
    maxAgeSeconds: CLIENT_SESSION_TTL_SECONDS,
  };
}

export async function findClientBySessionToken(token: string): Promise<ClientUser | undefined> {
  if (!token) {
    return undefined;
  }

  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const nextExpiresAt = new Date(now.getTime() + CLIENT_SESSION_TTL_SECONDS * 1000);

  const session = await prisma.clientSession.findUnique({
    where: { tokenHash },
    include: {
      client: {
        select: { id: true, name: true, phone: true, hasPassword: true, status: true, createdBy: true, createdAt: true },
      },
    },
  });

  if (!session || session.expiresAt <= now) {
    return undefined;
  }

  if (now.getTime() - session.lastSeenAt.getTime() >= CLIENT_SESSION_REFRESH_INTERVAL_MS) {
    await prisma.clientSession.update({
      where: { id: session.id },
      data: { expiresAt: nextExpiresAt, lastSeenAt: now },
    });
  }

  return toClientUser(session.client);
}

export async function revokeClientSession(token: string): Promise<void> {
  if (!token) {
    return;
  }

  await prisma.clientSession.deleteMany({
    where: { tokenHash: hashSessionToken(token) },
  });
}

export async function createClient(input: {
  name: string;
  phone: string;
  password: string;
}): Promise<ClientUser> {
  const normalizedPhone = normalizeClientPhone(input.phone);
  const passwordHash = await hashClientPassword(input.password);

  try {
    const existing = await findClientRecordByPhone(input.phone);

    if (existing?.hasPassword) {
      throw new Error("Já existe cadastro com este telefone");
    }

    if (existing) {
      const updated = await prisma.client.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          phone: input.phone,
          passwordHash,
          hasPassword: true,
          status: "ACTIVE",
        },
        select: { id: true, name: true, phone: true, hasPassword: true, status: true, createdBy: true, createdAt: true },
      });
      return toClientUser(updated);
    }

    const created = await prisma.client.create({
      data: {
        name: input.name,
        phone: input.phone,
        phoneNormalized: normalizedPhone,
        passwordHash,
        hasPassword: true,
        status: "ACTIVE",
        createdBy: "CLIENT",
      },
      select: { id: true, name: true, phone: true, hasPassword: true, status: true, createdBy: true, createdAt: true },
    });
    return toClientUser(created);
  } catch (error) {
    if (error instanceof Error && error.message) {
      throw error;
    }
    throw new Error("Já existe cadastro com este telefone");
  }
}

export async function authenticateClient(phone: string, password: string): Promise<ClientUser | null> {
  const client = await findClientRecordByPhone(phone);
  if (!client) {
    return null;
  }

  if (!client.hasPassword || !client.passwordHash) {
    return null;
  }

  const passwordOk = await verifyPassword(password, client.passwordHash);
  if (!passwordOk) {
    return null;
  }

  return toClientUser(client);
}
