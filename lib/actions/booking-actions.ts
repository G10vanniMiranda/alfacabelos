"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath, updateTag } from "next/cache";
import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  createGalleryImage,
  createService,
  createBlockedSlot,
  deleteGalleryImage,
  deleteService,
  deleteBlockedSlot,
  replaceBarberDayAvailability,
  rescheduleClientBooking,
  getBookingById,
  getGalleryImageById,
  confirmBookingByToken,
  updateBookingPaymentStatus,
  updateService,
  updateBookingStatus,
} from "@/lib/booking-service";
import { adminLoginSchema, createAdminBookingSchema } from "@/lib/validators/schemas";
import { ActionState } from "@/types/scheduler";
import { authenticateAdminAccess, registerAdminLogin } from "@/lib/auth/admin-access-store";
import { createAdminSession, revokeAdminSession } from "@/lib/auth/admin-session-store";
import { assertBlockedSlotScope, assertBookingScope, getCurrentStaff, requireStaff, scopeBarber } from "@/lib/auth/staff-auth";
import { notifyClientAboutAdminBooking, notifyClientAboutBookingCancellation, notifyClientAboutBookingRescheduled, notifyOwnerAboutBookingEvent, notifyOwnerAboutClientBooking } from "@/lib/whatsapp";
import { findClientBySessionToken } from "@/lib/auth/client-store";
import { prisma } from "@/lib/prisma";
import { cancelBookingSeries, createBookingSeriesAtomic, updateBookingSeriesOccurrences } from "@/lib/booking-series-service";
import { repository } from "@/lib/repositories";
import { clearRateLimitEvents, getClientIpFromHeaders, registerRateLimitEvent } from "@/lib/security";
import {
  deleteLocalGalleryFile,
  extractSafeSupabaseObjectPath,
  validateGalleryUpload,
} from "@/lib/media-security";

const ADMIN_COOKIE = "barber_admin";
const CLIENT_COOKIE = "barber_client";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "galeria";
const BOOKING_DIAGNOSTICS_ENABLED = process.env.BOOKING_DIAGNOSTICS === "true";

function logBookingDiagnostic(event: string, details: Record<string, string | number | boolean | undefined>) {
  if (!BOOKING_DIAGNOSTICS_ENABLED) {
    return;
  }

  console.info("[booking-flow]", {
    event,
    ...details,
  });
}

async function assertAdminSession() {
  return requireStaff(["ADMIN"]);
}

async function getAuthenticatedClient() {
  const cookieStore = await cookies();
  const token = cookieStore.get(CLIENT_COOKIE)?.value ?? "";
  if (!token) {
    return null;
  }

  return findClientBySessionToken(token);
}

async function notifyOwnerSafely(bookingId: string) {
  try {
    const booking = await getBookingById(bookingId);
    if (!booking) {
      console.warn(`[whatsapp] agendamento ${bookingId} não encontrado para notificar dono`);
      return;
    }

    await notifyOwnerAboutClientBooking(booking);
  } catch (error) {
    console.error(`[whatsapp] falha ao notificar dono sobre agendamento ${bookingId}`, error);
  }
}

async function notifyClientSafely(bookingId: string, rawConfirmationToken?: string) {
  try {
    const booking = await getBookingById(bookingId);
    if (!booking) {
      console.warn(`[whatsapp] agendamento ${bookingId} não encontrado para notificar cliente`);
      return;
    }

    await notifyClientAboutAdminBooking({
      ...booking,
      confirmationToken: rawConfirmationToken ?? booking.confirmationToken,
    });
  } catch (error) {
    console.error(`[whatsapp] falha ao notificar cliente sobre agendamento ${bookingId}`, error);
  }
}

function canUseSupabaseStorage() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function getSupabasePublicUrl(objectPath: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_STORAGE_BUCKET}/${objectPath}`;
}

async function uploadToSupabase(objectPath: string, file: File): Promise<string> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Configuração do storage ausente");
  }

  const endpoint = `${SUPABASE_URL}/storage/v1/object/${SUPABASE_STORAGE_BUCKET}/${objectPath}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      "content-type": file.type,
      "x-upsert": "false",
    },
    body: file,
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    const suffix = details ? ` (${response.status}): ${details.slice(0, 140)}` : ` (${response.status})`;
    throw new Error(`Falha ao enviar imagem para o storage${suffix}`);
  }

  return getSupabasePublicUrl(objectPath);
}

async function deleteFromSupabase(publicUrl: string) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Configuração do storage ausente");
  }
  const objectPath = extractSafeSupabaseObjectPath({
    publicUrl,
    supabaseUrl: SUPABASE_URL,
    bucket: SUPABASE_STORAGE_BUCKET,
  });

  const endpoint = `${SUPABASE_URL}/storage/v1/object/${SUPABASE_STORAGE_BUCKET}/${objectPath}`;
  const response = await fetch(endpoint, {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
    },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Falha ao remover mídia do storage (${response.status})`);
  }
}

export async function confirmBookingByTokenAction(payload: { token: string }): Promise<ActionState> {
  const genericFailure = "Não foi possível confirmar este agendamento. O link pode não estar mais disponível.";
  try {
    const token = payload.token.trim();
    if (token.length < 32 || token.length > 256) {
      return { success: false, message: genericFailure };
    }
    const requestHeaders = await headers();
    const ipLimit = await registerRateLimitEvent({
      scope: "booking-confirmation-ip",
      identifier: getClientIpFromHeaders(requestHeaders),
      windowSeconds: 15 * 60,
      maxAttempts: 20,
    });
    if (ipLimit.blocked) {
      return { success: false, message: genericFailure };
    }
    await confirmBookingByToken(token);
    revalidatePath("/confirmacao");
    revalidatePath("/confirmar-agendamento");
    revalidatePath("/admin/agenda");
    revalidatePath("/admin/dashboard");
    revalidatePath("/cliente");
    return { success: true, message: "Agendamento confirmado com sucesso." };
  } catch {
    return {
      success: false,
      message: genericFailure,
    };
  }
}

export async function confirmBookingByTokenFormAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return confirmBookingByTokenAction({
    token: String(formData.get("token") ?? ""),
  });
}

export async function createClientBookingsAction(payload: {
  serviceId: string;
  barberId: string;
  customerName: string;
  customerPhone: string;
  observations?: string;
  start: string;
  starts?: string[];
  recurrence: "NONE" | "DAILY" | "WEEKLY" | "MONTHLY";
  repeatUntil?: string;
  interval?: number;
  weekdays?: number[];
  idempotencyKey?: string;
  rescheduleBookingId?: string;
}): Promise<ActionState> {
  const client = await getAuthenticatedClient();
  if (!client) {
    logBookingDiagnostic("client_session_missing", {
      serviceId: payload.serviceId,
      starts: payload.starts?.length ?? 0,
    });
    return {
      success: false,
      message: "Sua sessão expirou. Faça login novamente para concluir o agendamento.",
    };
  }

  const parsed = createAdminBookingSchema.safeParse({
    ...payload,
    barberId: payload.barberId,
    customerName: client.name,
    customerPhone: client.phone,
  });
  if (!parsed.success) {
    logBookingDiagnostic("client_payload_invalid", {
      serviceId: payload.serviceId,
      reason: parsed.error.issues[0]?.message,
    });
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Dados inválidos para criar agendamento",
    };
  }

  try {
    const starts = parsed.data.starts?.length ? parsed.data.starts : [parsed.data.start];
    logBookingDiagnostic("client_booking_create_started", {
      clientId: client.id,
      serviceId: parsed.data.serviceId,
      starts: starts.length,
      recurrence: parsed.data.recurrence,
    });

    if (parsed.data.recurrence !== "NONE" && starts.length >= 60) {
      return {
        success: false,
        message: "Limite de 59 repetições por criação. Reduza o período.",
      };
    }

    if (payload.rescheduleBookingId) {
      if (parsed.data.recurrence !== "NONE" || starts.length !== 1) {
        return { success: false, message: "Reagendamentos não podem criar uma série recorrente." };
      }
      const updated = await rescheduleClientBooking({
        bookingId: payload.rescheduleBookingId,
        clientId: client.id,
        serviceId: parsed.data.serviceId,
        barberId: parsed.data.barberId,
        start: starts[0],
      });
      const updatedWithRelations = await getBookingById(updated.id);
      if (updatedWithRelations) await notifyOwnerAboutBookingEvent(updatedWithRelations, "BOOKING_RESCHEDULED").catch(() => undefined);
      revalidatePath("/cliente");
      revalidatePath("/agendar");
      revalidatePath("/admin/agenda");
      revalidatePath("/admin/dashboard");
      return { success: true, message: "Agendamento reagendado com sucesso.", bookingId: updated.id };
    }

    const creation = await createBookingSeriesAtomic({
      serviceId: parsed.data.serviceId,
      barberId: parsed.data.barberId,
      clientId: client.id,
      customerName: client.name,
      customerPhone: client.phone,
      observations: parsed.data.observations,
      start: parsed.data.start,
      recurrence: parsed.data.recurrence,
      repeatUntil: parsed.data.repeatUntil,
      interval: parsed.data.interval,
      weekdays: parsed.data.weekdays,
      idempotencyKey: parsed.data.idempotencyKey,
      createdBy: "CLIENT",
    });
    const createdBookingIds = creation.bookingIds;
    const firstBookingId = createdBookingIds[0];

    await Promise.all(createdBookingIds.map((bookingId) => notifyOwnerSafely(bookingId)));

    revalidatePath("/cliente");
    revalidatePath("/agendar");
    revalidatePath("/admin/agenda");
    revalidatePath("/admin/dashboard");

    return {
      success: true,
      message:
        createdBookingIds.length === 1
          ? "Agendamento criado com sucesso."
          : `${createdBookingIds.length} agendamentos criados com sucesso.`,
      bookingId: firstBookingId,
    };
  } catch (error) {
    logBookingDiagnostic("client_booking_create_failed", {
      clientId: client.id,
      serviceId: parsed.data.serviceId,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Falha ao criar agendamento",
    };
  }
}

export async function createAdminBookingsAction(payload: {
  serviceId: string;
  barberId: string;
  customerName: string;
  customerPhone: string;
  observations?: string;
  start: string;
  starts?: string[];
  recurrence: "NONE" | "DAILY" | "WEEKLY" | "MONTHLY";
  repeatUntil?: string;
  interval?: number;
  weekdays?: number[];
  idempotencyKey?: string;
}): Promise<ActionState> {
  const principal = await requireStaff(["ADMIN", "BARBER"]);

  const parsed = createAdminBookingSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Dados inválidos para criar agendamento",
    };
  }

  try {
    const starts = parsed.data.starts?.length ? parsed.data.starts : [parsed.data.start];

    if (parsed.data.recurrence !== "NONE" && starts.length >= 60) {
      return {
        success: false,
        message: "Limite de 59 repetições por criação. Reduza o período.",
      };
    }

    const pendingClient = await repository.upsertPendingClient({
      name: parsed.data.customerName,
      phone: parsed.data.customerPhone,
    });
    const creation = await createBookingSeriesAtomic({
      serviceId: parsed.data.serviceId,
      barberId: scopeBarber(principal, parsed.data.barberId)!,
      clientId: pendingClient.id,
      customerName: parsed.data.customerName,
      customerPhone: parsed.data.customerPhone,
      observations: parsed.data.observations,
      start: parsed.data.start,
      recurrence: parsed.data.recurrence,
      repeatUntil: parsed.data.repeatUntil,
      interval: parsed.data.interval,
      weekdays: parsed.data.weekdays,
      idempotencyKey: parsed.data.idempotencyKey,
      createdBy: "BARBER",
      requireConfirmation: true,
    });
    const createdBookingIds = creation.bookingIds;
    const firstBookingId = createdBookingIds[0];

    await Promise.all(createdBookingIds.map((bookingId) =>
      notifyClientSafely(bookingId, creation.rawConfirmationTokens.get(bookingId)),
    ));

    revalidatePath("/admin/agenda");
    revalidatePath("/admin/dashboard");

    return {
      success: true,
      message:
        createdBookingIds.length === 1
          ? "Agendamento criado com sucesso."
          : `${createdBookingIds.length} agendamentos criados com sucesso.`,
      bookingId: firstBookingId,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Falha ao criar agendamento",
    };
  }
}

export async function adminLoginAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = adminLoginSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });

  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Credenciais inválidas" };
  }

  const normalizedEmail = parsed.data.email.trim().toLowerCase();
  const blockStatus = await registerRateLimitEvent({
    scope: "admin-login",
    identifier: normalizedEmail,
    windowSeconds: 15 * 60,
    maxAttempts: 5,
  });
  if (blockStatus.blocked) {
    const minutes = Math.ceil(blockStatus.retryAfterSeconds / 60);
    return {
      success: false,
      message: `Muitas tentativas de login. Tente novamente em ${minutes} minuto(s).`,
    };
  }

  try {
    const staff = await authenticateAdminAccess(parsed.data.email, parsed.data.password);
    if (!staff) {
      return { success: false, message: "E-mail ou senha incorretos." };
    }

    await clearRateLimitEvents("admin-login", normalizedEmail);
    await registerAdminLogin(staff.id);
    const session = await createAdminSession({ email: normalizedEmail, adminAccessId: staff.id });
    const cookieStore = await cookies();
    cookieStore.set(ADMIN_COOKIE, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: session.maxAgeSeconds,
    });
    return { success: true, message: "Acesso confirmado." };
  } catch {
    return { success: false, message: "Não foi possível acessar sua conta agora. Tente novamente em alguns instantes." };
  }
}

export async function adminLogoutAction() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE)?.value ?? "";
  await revokeAdminSession(token);
  cookieStore.delete(ADMIN_COOKIE);
}

export async function updateBookingStatusAction(payload: { bookingId: string; status: "PENDENTE" | "CONFIRMADO" | "CANCELADO" | "CONCLUIDO" | "AUSENTE"; scope?: "SINGLE" | "FUTURE" | "ALL" }) {
  const principal = await requireStaff(["ADMIN", "BARBER"]);
  await assertBookingScope(principal, payload.bookingId);
  let affectedIds = [payload.bookingId];
  if (payload.status === "CANCELADO" && payload.scope && payload.scope !== "SINGLE") {
    const result = await cancelBookingSeries({ bookingId: payload.bookingId, scope: payload.scope });
    affectedIds = result.bookingIds;
  } else {
    await updateBookingStatus({ bookingId: payload.bookingId, status: payload.status });
  }
  if (payload.status === "CANCELADO") {
    await Promise.all(affectedIds.map(async (bookingId) => {
      const booking = await getBookingById(bookingId);
      if (booking) await notifyClientAboutBookingCancellation(booking).catch(() => undefined);
    }));
  }
  revalidatePath("/admin/agenda");
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/ganhos");
}

export async function updateBookingPaymentStatusAction(payload: {
  bookingId: string;
  paymentStatus: "PENDENTE" | "CONFIRMADO";
}) {
  await assertAdminSession();
  await updateBookingPaymentStatus(payload);
  revalidatePath("/admin/agenda");
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/ganhos");
}

export async function updateAdminBookingAction(payload: {
  bookingId: string;
  serviceId: string;
  barberId: string;
  customerName: string;
  customerPhone: string;
  observations?: string;
  start: string;
  scope?: "SINGLE" | "FUTURE" | "ALL";
}): Promise<ActionState> {
  const principal = await requireStaff(["ADMIN", "BARBER"]);
  await assertBookingScope(principal, payload.bookingId);

  try {
    const result = await updateBookingSeriesOccurrences({
      ...payload,
      scope: payload.scope ?? "SINGLE",
      barberId: scopeBarber(principal, payload.barberId)!,
    });
    await Promise.all(result.bookingIds.map(async (bookingId) => {
      const booking = await getBookingById(bookingId);
      if (booking) await notifyClientAboutBookingRescheduled(booking).catch(() => undefined);
    }));
    revalidatePath("/admin/agenda");
    revalidatePath("/admin/dashboard");
    revalidatePath("/cliente");
    return { success: true, message: "Agendamento atualizado com sucesso." };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Falha ao atualizar agendamento",
    };
  }
}

export async function createBlockedSlotAction(payload: {
  barberId?: string;
  dateTimeStart: string;
  dateTimeEnd: string;
  reason: string;
}) {
  const principal = await requireStaff(["ADMIN", "BARBER"]);
  await createBlockedSlot({ ...payload, barberId: scopeBarber(principal, payload.barberId) });
  revalidatePath("/admin/bloqueios");
  revalidatePath("/admin/agenda");
}

export async function deleteBlockedSlotAction(payload: { blockedSlotId: string }) {
  const principal = await requireStaff(["ADMIN", "BARBER"]);
  await assertBlockedSlotScope(principal, payload.blockedSlotId);
  await deleteBlockedSlot(payload.blockedSlotId);
  revalidatePath("/admin/bloqueios");
  revalidatePath("/admin/agenda");
}

export async function replaceBarberDayAvailabilityAction(payload: {
  barberId: string;
  dayOfWeek: number;
  ranges: Array<{
    openTime: string;
    closeTime: string;
  }>;
}) {
  await assertAdminSession();
  await replaceBarberDayAvailability(payload);
  revalidatePath("/admin/horarios");
  revalidatePath("/agendar");
  updateTag("barbers");
}

export async function updateServiceAction(payload: {
  serviceId: string;
  name: string;
  priceCents: number;
  durationMinutes: number;
  isProcedure: boolean;
}) {
  await assertAdminSession();
  await updateService(payload);
  revalidatePath("/admin/servicos");
  revalidatePath("/");
  revalidatePath("/agendar");
  updateTag("services");
}

export async function createServiceAction(payload: {
  name: string;
  priceCents: number;
  durationMinutes: number;
  isProcedure: boolean;
}) {
  await assertAdminSession();
  await createService(payload);
  revalidatePath("/admin/servicos");
  revalidatePath("/");
  revalidatePath("/agendar");
  updateTag("services");
}

export async function deleteServiceAction(payload: { serviceId: string }) {
  await assertAdminSession();
  await deleteService(payload.serviceId);
  revalidatePath("/admin/servicos");
  revalidatePath("/");
  revalidatePath("/agendar");
  updateTag("services");
}

export async function uploadGalleryImageAction(formData: FormData): Promise<ActionState> {
  try {
    await assertAdminSession();
    const fileValue = formData.get("file");
    const altRaw = String(formData.get("altText") ?? "").trim();
    const altText = altRaw.length > 0 ? altRaw : undefined;

    if (!(fileValue instanceof File)) {
      return { success: false, message: "Selecione uma foto ou vídeo para envio" };
    }
    const validated = await validateGalleryUpload(fileValue);
    const filename = `${Date.now()}-${randomUUID()}.${validated.extension}`;
    const objectPath = `galeria/${filename}`;

    let imageUrl = "";
    if (canUseSupabaseStorage()) {
      imageUrl = await uploadToSupabase(objectPath, fileValue);
    } else if (process.env.NODE_ENV !== "production") {
      const relativePath = `/uploads/galeria/${filename}`;
      const uploadDir = path.join(process.cwd(), "public", "uploads", "galeria");
      const absolutePath = path.join(uploadDir, filename);
      await mkdir(uploadDir, { recursive: true });
      await pipeline(
        Readable.from(fileValue.stream() as unknown as AsyncIterable<Uint8Array>),
        createWriteStream(absolutePath, { flags: "wx" }),
      );
      imageUrl = relativePath;
    } else {
      return {
        success: false,
        message: "Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_KEY) na Vercel",
      };
    }

    await createGalleryImage({ imageUrl, altText, mediaType: validated.mediaType });
    revalidatePath("/admin/galeria");
    revalidatePath("/");
    updateTag("gallery-images");
    return {
      success: true,
      message: validated.mediaType === "VIDEO" ? "Vídeo adicionado à galeria" : "Foto adicionada à galeria",
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Falha ao fazer upload da imagem",
    };
  }
}

export async function deleteGalleryImageAction(payload: { galleryImageId: string }) {
  await assertAdminSession();
  const persisted = await getGalleryImageById(payload.galleryImageId);
  if (!persisted) {
    throw new Error("Mídia não encontrada");
  }

  if (persisted.imageUrl.startsWith("/")) {
    await deleteLocalGalleryFile(persisted.imageUrl, { unlinkFile: unlink });
  } else {
    await deleteFromSupabase(persisted.imageUrl);
  }
  await deleteGalleryImage(payload);

  revalidatePath("/admin/galeria");
  revalidatePath("/");
  updateTag("gallery-images");
}

export async function isAdminAuthenticated() {
  return (await getCurrentStaff())?.role === "ADMIN";
}

export async function getStaffAuthentication() {
  return getCurrentStaff();
}

export async function createBarberAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  await assertAdminSession();
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2) return { success: false, message: "Informe o nome do barbeiro" };
  await prisma.barber.create({ data: { name, isActive: true } });
  revalidatePath("/admin/barbeiros");
  updateTag("barbers");
  return { success: true, message: "Barbeiro criado" };
}

export async function updateBarberAction(input: { barberId: string; name: string; isActive: boolean }): Promise<ActionState> {
  await assertAdminSession();
  const name = input.name.trim();
  if (!input.barberId || name.length < 2) return { success: false, message: "Dados inválidos" };
  await prisma.barber.update({ where: { id: input.barberId }, data: { name, isActive: input.isActive } });
  revalidatePath("/admin/barbeiros");
  updateTag("barbers");
  return { success: true, message: "Barbeiro atualizado" };
}
