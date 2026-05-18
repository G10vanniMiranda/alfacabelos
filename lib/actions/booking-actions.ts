"use server";

import { cookies } from "next/headers";
import { revalidatePath, updateTag } from "next/cache";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  createGalleryImage,
  createService,
  createBlockedSlot,
  createBooking,
  deleteGalleryImage,
  deleteService,
  deleteBlockedSlot,
  replaceBarberDayAvailability,
  updateAdminBooking,
  updateBookingPaymentStatus,
  updateService,
  updateBookingStatus,
} from "@/lib/booking-service";
import { adminLoginSchema, createAdminBookingSchema } from "@/lib/validators/schemas";
import { ActionState } from "@/types/scheduler";
import { authenticateAdminAccess, registerAdminLogin } from "@/lib/auth/admin-access-store";
import { createAdminSession, isAdminSessionTokenValid, revokeAdminSession } from "@/lib/auth/admin-session-store";
import {
  clearAdminLoginAttempts,
  getAdminLoginBlockStatus,
  registerFailedAdminLogin,
} from "@/lib/auth/admin-login-attempt-store";

const ADMIN_COOKIE = "barber_admin";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "galeria";

async function assertAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE)?.value ?? "";
  const authorized = await isAdminSessionTokenValid(token);
  if (!authorized) {
    throw new Error("Não autorizado");
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
  const body = Buffer.from(await file.arrayBuffer());
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      "content-type": file.type,
      "x-upsert": "false",
    },
    body,
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    const suffix = details ? ` (${response.status}): ${details.slice(0, 140)}` : ` (${response.status})`;
    throw new Error(`Falha ao enviar imagem para o storage${suffix}`);
  }

  return getSupabasePublicUrl(objectPath);
}

function extractSupabaseObjectPath(publicUrl: string): string | null {
  if (!SUPABASE_URL) {
    return null;
  }

  try {
    const parsed = new URL(publicUrl);
    const expectedPrefix = `/storage/v1/object/public/${SUPABASE_STORAGE_BUCKET}/`;
    if (!parsed.pathname.startsWith(expectedPrefix)) {
      return null;
    }
    return decodeURIComponent(parsed.pathname.slice(expectedPrefix.length));
  } catch {
    return null;
  }
}

async function deleteFromSupabase(publicUrl: string) {
  const objectPath = extractSupabaseObjectPath(publicUrl);
  if (!objectPath || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return;
  }

  const endpoint = `${SUPABASE_URL}/storage/v1/object/${SUPABASE_STORAGE_BUCKET}/${objectPath}`;
  await fetch(endpoint, {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
    },
  });
}

export async function createBookingAction(payload: {
  serviceId: string;
  start: string;
  customerName: string;
  customerPhone: string;
}): Promise<ActionState> {
  try {
    const booking = await createBooking(payload);
    return {
      success: true,
      message: "Agendamento criado com sucesso.",
      bookingId: booking.id,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Falha ao criar agendamento",
    };
  }
}

function addRecurrenceStep(date: Date, recurrence: "NONE" | "DAILY" | "WEEKLY" | "MONTHLY") {
  const next = new Date(date);
  if (recurrence === "DAILY") {
    next.setDate(next.getDate() + 1);
    return next;
  }
  if (recurrence === "WEEKLY") {
    next.setDate(next.getDate() + 7);
    return next;
  }
  if (recurrence === "MONTHLY") {
    next.setMonth(next.getMonth() + 1);
    return next;
  }
  next.setDate(next.getDate() + 1000);
  return next;
}

export async function createAdminBookingsAction(payload: {
  serviceId: string;
  barberId: string;
  customerName: string;
  customerPhone: string;
  start: string;
  starts?: string[];
  recurrence: "NONE" | "DAILY" | "WEEKLY" | "MONTHLY";
  repeatUntil?: string;
}): Promise<ActionState> {
  await assertAdminSession();

  const parsed = createAdminBookingSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Dados invalidos para criar agendamento",
    };
  }

  try {
    let starts = parsed.data.starts?.length ? parsed.data.starts : [];

    if (starts.length === 0) {
      const fallbackStarts: string[] = [];
      const firstStart = new Date(parsed.data.start);
      const repeatUntil = parsed.data.repeatUntil ? new Date(`${parsed.data.repeatUntil}T23:59:59`) : null;
      let cursor = new Date(firstStart);

      while (fallbackStarts.length < 60) {
        if (repeatUntil && cursor > repeatUntil) {
          break;
        }

        fallbackStarts.push(cursor.toISOString());

        if (parsed.data.recurrence === "NONE") {
          break;
        }

        cursor = addRecurrenceStep(cursor, parsed.data.recurrence);
      }

      starts = fallbackStarts;
    }

    if (parsed.data.recurrence !== "NONE" && starts.length >= 60) {
      return {
        success: false,
        message: "Limite de 59 repeticoes por criacao. Reduza o periodo.",
      };
    }

    let firstBookingId: string | undefined;

    for (const start of starts) {
      const booking = await createBooking({
        serviceId: parsed.data.serviceId,
        barberId: parsed.data.barberId,
        start,
        customerName: parsed.data.customerName,
        customerPhone: parsed.data.customerPhone,
      });

      if (!firstBookingId) {
        firstBookingId = booking.id;
      }
    }

    revalidatePath("/admin/agenda");
    revalidatePath("/admin/dashboard");

    return {
      success: true,
      message:
        starts.length === 1
          ? "Agendamento criado com sucesso."
          : `${starts.length} agendamentos criados com sucesso.`,
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

  const blockStatus = await getAdminLoginBlockStatus(parsed.data.email);
  if (blockStatus.blocked) {
    const minutes = Math.ceil(blockStatus.retryAfterSeconds / 60);
    return {
      success: false,
      message: `Muitas tentativas de login. Tente novamente em ${minutes} minuto(s).`,
    };
  }

  const adminByDatabase = await authenticateAdminAccess(parsed.data.email, parsed.data.password);
  if (!adminByDatabase) {
    await registerFailedAdminLogin(parsed.data.email);
    return { success: false, message: "Email ou senha incorretos" };
  }

  await clearAdminLoginAttempts(parsed.data.email);
  await registerAdminLogin(adminByDatabase.id);

  const session = await createAdminSession({
    email: parsed.data.email.trim().toLowerCase(),
    adminAccessId: adminByDatabase.id,
  });

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: session.maxAgeSeconds,
  });

  return { success: true, message: "Login efetuado" };
}

export async function adminLogoutAction() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE)?.value ?? "";
  await revokeAdminSession(token);
  cookieStore.delete(ADMIN_COOKIE);
}

export async function updateBookingStatusAction(payload: { bookingId: string; status: "PENDENTE" | "CONFIRMADO" | "CANCELADO" }) {
  await assertAdminSession();
  await updateBookingStatus(payload);
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
  start: string;
}): Promise<ActionState> {
  await assertAdminSession();

  try {
    await updateAdminBooking(payload);
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
  await assertAdminSession();
  await createBlockedSlot(payload);
  revalidatePath("/admin/bloqueios");
  revalidatePath("/admin/agenda");
}

export async function deleteBlockedSlotAction(payload: { blockedSlotId: string }) {
  await assertAdminSession();
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

export async function createGalleryImageAction(payload: {
  imageUrl: string;
  altText?: string;
  mediaType?: "IMAGE" | "VIDEO";
}) {
  await assertAdminSession();
  await createGalleryImage(payload);
  revalidatePath("/admin/galeria");
  revalidatePath("/");
  updateTag("gallery-images");
}

const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const ACCEPTED_VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

function extensionFromMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/avif") return "avif";
  if (mime === "video/mp4") return "mp4";
  if (mime === "video/webm") return "webm";
  if (mime === "video/quicktime") return "mov";
  return "jpg";
}

export async function uploadGalleryImageAction(formData: FormData): Promise<ActionState> {
  try {
    await assertAdminSession();
    const fileValue = formData.get("file");
    const altRaw = String(formData.get("altText") ?? "").trim();
    const altText = altRaw.length > 0 ? altRaw : undefined;

    if (!(fileValue instanceof File)) {
      return { success: false, message: "Selecione uma foto ou video para upload" };
    }
    const isImage = ACCEPTED_IMAGE_TYPES.has(fileValue.type);
    const isVideo = ACCEPTED_VIDEO_TYPES.has(fileValue.type);
    if (!isImage && !isVideo) {
      return { success: false, message: "Formato invalido. Use JPG, PNG, WEBP, AVIF, MP4, WEBM ou MOV" };
    }
    if (fileValue.size === 0) {
      return { success: false, message: "Arquivo vazio" };
    }
    if (isImage && fileValue.size > MAX_IMAGE_BYTES) {
      return { success: false, message: "Imagem deve ter ate 5MB" };
    }
    if (isVideo && fileValue.size > MAX_VIDEO_BYTES) {
      return { success: false, message: "Video deve ter ate 50MB" };
    }

    const ext = extensionFromMime(fileValue.type);
    const filename = `${Date.now()}-${randomUUID()}.${ext}`;
    const objectPath = `galeria/${filename}`;
    const mediaType = isVideo ? "VIDEO" : "IMAGE";

    let imageUrl = "";
    if (canUseSupabaseStorage()) {
      imageUrl = await uploadToSupabase(objectPath, fileValue);
    } else if (process.env.NODE_ENV !== "production") {
      const relativePath = `/uploads/galeria/${filename}`;
      const uploadDir = path.join(process.cwd(), "public", "uploads", "galeria");
      const absolutePath = path.join(uploadDir, filename);
      await mkdir(uploadDir, { recursive: true });
      const buffer = Buffer.from(await fileValue.arrayBuffer());
      await writeFile(absolutePath, buffer);
      imageUrl = relativePath;
    } else {
      return {
        success: false,
        message: "Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_KEY) na Vercel",
      };
    }

    await createGalleryImage({ imageUrl, altText, mediaType });
    revalidatePath("/admin/galeria");
    revalidatePath("/");
    updateTag("gallery-images");
    return { success: true, message: isVideo ? "Video adicionado na galeria" : "Foto adicionada na galeria" };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Falha ao fazer upload da imagem",
    };
  }
}

export async function deleteGalleryImageAction(payload: { galleryImageId: string; imageUrl?: string }) {
  await assertAdminSession();
  await deleteGalleryImage(payload);

  if (payload.imageUrl?.startsWith("/uploads/galeria/")) {
    const absolutePath = path.join(process.cwd(), "public", payload.imageUrl);
    await unlink(absolutePath).catch(() => undefined);
  }

  if (payload.imageUrl?.startsWith("http")) {
    await deleteFromSupabase(payload.imageUrl);
  }

  revalidatePath("/admin/galeria");
  revalidatePath("/");
  updateTag("gallery-images");
}

export async function isAdminAuthenticated() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE)?.value ?? "";
  try {
    return await isAdminSessionTokenValid(token);
  } catch {
    return false;
  }
}
