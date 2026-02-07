import { ClientUser } from "@/types/domain";

const clients: ClientUser[] = [];

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

export async function findClientByPhone(phone: string): Promise<ClientUser | undefined> {
  const normalized = normalizePhone(phone);
  return clients.find((client) => normalizePhone(client.phone) === normalized);
}

export async function findClientById(id: string): Promise<ClientUser | undefined> {
  return clients.find((client) => client.id === id);
}

export async function createClient(input: {
  name: string;
  phone: string;
  password: string;
}): Promise<ClientUser> {
  const existing = await findClientByPhone(input.phone);
  if (existing) {
    throw new Error("Ja existe cadastro com este telefone");
  }

  const client: ClientUser = {
    id: `client-${crypto.randomUUID()}`,
    name: input.name,
    phone: input.phone,
    password: input.password,
    createdAt: new Date().toISOString(),
  };

  clients.push(client);
  return client;
}

export async function authenticateClient(phone: string, password: string): Promise<ClientUser | null> {
  const client = await findClientByPhone(phone);
  if (!client) {
    return null;
  }

  if (client.password !== password) {
    return null;
  }

  return client;
}
