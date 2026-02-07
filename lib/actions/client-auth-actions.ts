"use server";

import { cookies } from "next/headers";
import { clientLoginSchema, clientRegisterSchema } from "@/lib/validators/schemas";
import { authenticateClient, createClient, findClientById } from "@/lib/auth/client-store";
import { ActionState } from "@/types/scheduler";

const CLIENT_COOKIE = "barber_client";

async function setClientCookie(clientId: string) {
  const cookieStore = await cookies();
  cookieStore.set(CLIENT_COOKIE, clientId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function getCurrentClient() {
  const cookieStore = await cookies();
  const clientId = cookieStore.get(CLIENT_COOKIE)?.value;
  if (!clientId) {
    return null;
  }

  return findClientById(clientId);
}

export async function registerClientAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = clientRegisterSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    password: String(formData.get("password") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  });

  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Dados invalidos" };
  }

  try {
    const client = await createClient(parsed.data);
    await setClientCookie(client.id);
    return { success: true, message: "Cadastro realizado com sucesso" };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "Falha no cadastro" };
  }
}

export async function loginClientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = clientLoginSchema.safeParse({
    phone: String(formData.get("phone") ?? ""),
    password: String(formData.get("password") ?? ""),
  });

  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Dados invalidos" };
  }

  const client = await authenticateClient(parsed.data.phone, parsed.data.password);
  if (!client) {
    return { success: false, message: "Telefone ou senha incorretos" };
  }

  await setClientCookie(client.id);
  return { success: true, message: "Login realizado com sucesso" };
}

export async function logoutClientAction() {
  const cookieStore = await cookies();
  cookieStore.delete(CLIENT_COOKIE);
}
