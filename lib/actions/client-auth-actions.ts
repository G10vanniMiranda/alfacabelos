"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { clientLoginSchema, clientRegisterSchema } from "@/lib/validators/schemas";
import { authenticateClient, createClient, findClientById } from "@/lib/auth/client-store";
import { cancelClientBooking } from "@/lib/booking-service";
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

  try {
    return await findClientById(clientId);
  } catch {
    return null;
  }
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
    return { success: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  try {
    const client = await createClient(parsed.data);
    await setClientCookie(client.id);
    return { success: true, message: "Cadastro realizado com sucesso" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha no cadastro";
    if (message.includes("Can't reach database server")) {
      return { success: false, message: "Banco indisponivel no momento. Tente novamente em instantes." };
    }
    return { success: false, message };
  }
}

export async function loginClientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = clientLoginSchema.safeParse({
    phone: String(formData.get("phone") ?? ""),
    password: String(formData.get("password") ?? ""),
  });

  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  let client = null;
  try {
    client = await authenticateClient(parsed.data.phone, parsed.data.password);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("Can't reach database server")) {
      return { success: false, message: "Banco indisponivel no momento. Tente novamente em instantes." };
    }
    return { success: false, message: "Falha ao realizar login" };
  }

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

export async function cancelMyBookingAction(formData: FormData) {
  const bookingId = String(formData.get("bookingId") ?? "");
  if (!bookingId) {
    return;
  }

  const client = await getCurrentClient();
  if (!client) {
    return;
  }

  await cancelClientBooking({ bookingId, customerPhone: client.phone });
  revalidatePath("/cliente");
  revalidatePath("/admin/agenda");
}
