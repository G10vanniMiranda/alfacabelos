import { ClientUser } from "@/types/domain";
import { prisma } from "@/lib/prisma";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
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

function toClientUser(row: { id: string; name: string; phone: string; createdAt: Date }): ClientUser {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function findClientByPhone(phone: string): Promise<ClientUser | undefined> {
  const normalized = normalizePhone(phone);
  const client = await prisma.client.findUnique({
    where: { phoneNormalized: normalized },
    select: { id: true, name: true, phone: true, createdAt: true },
  });
  return client ? toClientUser(client) : undefined;
}

export async function findClientById(id: string): Promise<ClientUser | undefined> {
  const client = await prisma.client.findUnique({
    where: { id },
    select: { id: true, name: true, phone: true, createdAt: true },
  });
  return client ? toClientUser(client) : undefined;
}

export async function createClient(input: {
  name: string;
  phone: string;
  password: string;
}): Promise<ClientUser> {
  const normalizedPhone = normalizePhone(input.phone);
  const passwordHash = await hashPassword(input.password);

  try {
    const created = await prisma.client.create({
      data: {
        name: input.name,
        phone: input.phone,
        phoneNormalized: normalizedPhone,
        passwordHash,
      },
      select: { id: true, name: true, phone: true, createdAt: true },
    });
    return toClientUser(created);
  } catch {
    throw new Error("Ja existe cadastro com este telefone");
  }
}

export async function authenticateClient(phone: string, password: string): Promise<ClientUser | null> {
  const normalized = normalizePhone(phone);
  const client = await prisma.client.findUnique({
    where: { phoneNormalized: normalized },
  });
  if (!client) {
    return null;
  }

  const passwordOk = await verifyPassword(password, client.passwordHash);
  if (!passwordOk) {
    return null;
  }

  return toClientUser(client);
}
