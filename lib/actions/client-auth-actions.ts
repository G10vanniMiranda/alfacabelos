"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  clientLoginSchema,
  clientRegisterSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
} from "@/lib/validators/schemas";
import {
  authenticateClient,
  createClient,
  createClientSession,
  findClientByPhone,
  findClientBySessionToken,
  normalizeClientPhone,
  revokeClientSession,
} from "@/lib/auth/client-store";
import {
  buildPasswordResetWhatsAppMessage,
  createPasswordResetForIdentifier,
  PASSWORD_RESET_GENERIC_MESSAGE,
  registerPasswordResetAttempt,
  resetClientPasswordWithToken,
} from "@/lib/auth/client-password-reset-store";
import { confirmClientBooking, getBookingById } from "@/lib/booking-service";
import { notifyOwnerAboutBookingEvent } from "@/lib/whatsapp";
import { cancelBookingSeries } from "@/lib/booking-series-service";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { clearRateLimitEvents, registerRateLimitEvent } from "@/lib/security";
import { ActionState } from "@/types/scheduler";
import { prisma } from "@/lib/prisma";

const CLIENT_COOKIE = "barber_client";

function logPasswordResetAction(event: string, details: Record<string, string | number | boolean | null | undefined> = {}) {
  console.info("[password-reset]", JSON.stringify({ event, ...details }));
}

async function setClientCookie(clientId: string) {
  const session = await createClientSession(clientId);
  const cookieStore = await cookies();
  cookieStore.set(CLIENT_COOKIE, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: session.maxAgeSeconds,
  });
}

export async function getCurrentClient() {
  const cookieStore = await cookies();
  const token = cookieStore.get(CLIENT_COOKIE)?.value;
  if (!token) {
    return null;
  }

  try {
    return await findClientBySessionToken(token);
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
    const requestHeaders = await headers();
    const clientIp = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim()
      || requestHeaders.get("x-real-ip")
      || "unknown";
    const rateLimit = await registerRateLimitEvent({
      scope: "client-register",
      identifier: clientIp,
      windowSeconds: 15 * 60,
      maxAttempts: 5,
    });
    if (rateLimit.blocked) {
      return { success: false, message: "Muitas tentativas de cadastro. Aguarde alguns minutos." };
    }

    const client = await createClient(parsed.data);
    await setClientCookie(client.id);
    return { success: true, message: "Cadastro realizado com sucesso" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha no cadastro";
    if (message.includes("Can't reach database server")) {
      return { success: false, message: "Não foi possível acessar sua conta agora. Tente novamente em alguns instantes." };
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

  const blockStatus = await registerRateLimitEvent({
    scope: "client-login",
    identifier: normalizeClientPhone(parsed.data.phone),
    windowSeconds: 15 * 60,
    maxAttempts: 8,
  });
  if (blockStatus.blocked) {
    const minutes = Math.ceil(blockStatus.retryAfterSeconds / 60);
    return {
      success: false,
      message: `Muitas tentativas de login. Tente novamente em ${minutes} minuto(s).`,
    };
  }

  let client = null;
  try {
    client = await authenticateClient(parsed.data.phone, parsed.data.password);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("Can't reach database server")) {
      return { success: false, message: "Não foi possível acessar sua conta agora. Tente novamente em alguns instantes." };
    }
    return { success: false, message: "Não foi possível acessar sua conta agora. Tente novamente em alguns instantes." };
  }

  if (!client) {
    const existing = await findClientByPhone(parsed.data.phone).catch(() => undefined);
    if (existing && !existing.hasPassword) {
      return {
        success: false,
        code: "PASSWORD_SETUP_REQUIRED",
        message: "Seu cadastro já existe, mas você ainda precisa criar uma senha para acessar.",
      };
    }
    return { success: false, message: "Telefone ou senha incorretos." };
  }

  await clearRateLimitEvents("client-login", normalizeClientPhone(parsed.data.phone));
  await setClientCookie(client.id);
  return { success: true, message: "Login realizado com sucesso" };
}

export async function requestClientPasswordResetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = requestPasswordResetSchema.safeParse({
    identifier: String(formData.get("identifier") ?? ""),
  });

  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Dados invalidos" };
  }

  try {
    const rateLimit = await registerPasswordResetAttempt(parsed.data.identifier);
    if (rateLimit.blocked) {
      return {
        success: true,
        message: PASSWORD_RESET_GENERIC_MESSAGE,
      };
    }

    const reset = await createPasswordResetForIdentifier(parsed.data.identifier);
    if (reset) {
      logPasswordResetAction("notification_attempt");
      const sent = await sendWhatsAppMessage({
        to: reset.clientPhone,
        message: buildPasswordResetWhatsAppMessage(reset.clientName, reset.resetLink),
        context: "recuperacao-senha-cliente",
      });
      logPasswordResetAction(sent ? "notification_sent" : "notification_skipped");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("Can't reach database server")) {
      return { success: false, message: "Não foi possível acessar sua conta agora. Tente novamente em alguns instantes." };
    }

    console.error("[password-reset] falha ao processar solicitacao");
  }

  return { success: true, message: PASSWORD_RESET_GENERIC_MESSAGE };
}

export async function resetClientPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse({
    token: String(formData.get("token") ?? ""),
    password: String(formData.get("password") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  });

  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Dados invalidos" };
  }

  try {
    const updated = await resetClientPasswordWithToken(parsed.data.token, parsed.data.password);
    if (!updated) {
      return { success: false, message: "Este link de recuperacao e invalido, expirou ou ja foi utilizado." };
    }

    return { success: true, message: "Senha redefinida com sucesso. Faca login para continuar." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("Can't reach database server")) {
      return { success: false, message: "Não foi possível acessar sua conta agora. Tente novamente em alguns instantes." };
    }
    return { success: false, message: "Falha ao redefinir senha" };
  }
}

export async function logoutClientAction() {
  const cookieStore = await cookies();
  const token = cookieStore.get(CLIENT_COOKIE)?.value ?? "";
  await revokeClientSession(token);
  cookieStore.delete(CLIENT_COOKIE);
}

export async function updateMyProfileAction(formData: FormData) {
  const client = await getCurrentClient();
  if (!client) return;
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const phoneNormalized = normalizeClientPhone(phone);
  if (name.length < 2 || phoneNormalized.length < 10 || phoneNormalized.length > 13) return;
  await prisma.$transaction([
    prisma.client.update({ where: { id: client.id }, data: { name, phone, phoneNormalized } }),
    prisma.booking.updateMany({ where: { clientId: client.id }, data: { customerName: name, customerPhone: phone } }),
  ]);
  revalidatePath("/cliente");
}

export async function cancelMyBookingAction(formData: FormData) {
  const bookingId = String(formData.get("bookingId") ?? "");
  const requestedScope = String(formData.get("scope") ?? "SINGLE");
  const scope = requestedScope === "FUTURE" || requestedScope === "ALL" ? requestedScope : "SINGLE";
  if (!bookingId) {
    return;
  }

  const client = await getCurrentClient();
  if (!client) {
    return;
  }

  const result = await cancelBookingSeries({ bookingId, clientId: client.id, scope });
  await Promise.all(result.bookingIds.map(async (id) => {
    const cancelled = await getBookingById(id);
    if (cancelled) await notifyOwnerAboutBookingEvent(cancelled, "BOOKING_CANCELLED").catch(() => undefined);
  }));
  revalidatePath("/cliente");
  revalidatePath("/admin/agenda");
}

export async function confirmMyBookingAction(formData: FormData) {
  const bookingId = String(formData.get("bookingId") ?? "");
  if (!bookingId) {
    return;
  }

  const client = await getCurrentClient();
  if (!client) {
    return;
  }

  await confirmClientBooking({ bookingId, customerPhone: client.phone });
  revalidatePath("/cliente");
  revalidatePath("/admin/agenda");
}
