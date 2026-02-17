"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
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
  updateService,
  updateBookingStatus,
} from "@/lib/booking-service";
import { adminLoginSchema } from "@/lib/validators/schemas";
import { ActionState } from "@/types/scheduler";

const ADMIN_COOKIE = "barber_admin";

function isAdminPasswordValid(password: string): boolean {
  const fromEnv = process.env.ADMIN_PASSWORD;
  if (!fromEnv) {
    return false;
  }
  return password === fromEnv;
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

export async function adminLoginAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = adminLoginSchema.safeParse({
    password: String(formData.get("password") ?? ""),
  });

  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Senha inválida" };
  }

  if (!isAdminPasswordValid(parsed.data.password)) {
    return { success: false, message: "Senha incorreta ou ADMIN_PASSWORD não configurada" };
  }

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE, "ok", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  return { success: true, message: "Login efetuado" };
}

export async function adminLogoutAction() {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_COOKIE);
}

export async function updateBookingStatusAction(payload: { bookingId: string; status: "PENDENTE" | "CONFIRMADO" | "CANCELADO" }) {
  await updateBookingStatus(payload);
  revalidatePath("/admin/agenda");
}

export async function createBlockedSlotAction(payload: {
  barberId?: string;
  dateTimeStart: string;
  dateTimeEnd: string;
  reason: string;
}) {
  await createBlockedSlot(payload);
  revalidatePath("/admin/bloqueios");
  revalidatePath("/admin/agenda");
}

export async function deleteBlockedSlotAction(payload: { blockedSlotId: string }) {
  await deleteBlockedSlot(payload.blockedSlotId);
  revalidatePath("/admin/bloqueios");
  revalidatePath("/admin/agenda");
}

export async function updateServiceAction(payload: {
  serviceId: string;
  name: string;
  priceCents: number;
}) {
  await updateService(payload);
  revalidatePath("/admin/servicos");
  revalidatePath("/");
  revalidatePath("/agendar");
}

export async function createServiceAction(payload: {
  name: string;
  priceCents: number;
}) {
  await createService(payload);
  revalidatePath("/admin/servicos");
  revalidatePath("/");
  revalidatePath("/agendar");
}

export async function deleteServiceAction(payload: { serviceId: string }) {
  await deleteService(payload.serviceId);
  revalidatePath("/admin/servicos");
  revalidatePath("/");
  revalidatePath("/agendar");
}

export async function createGalleryImageAction(payload: {
  imageUrl: string;
  altText?: string;
}) {
  await createGalleryImage(payload);
  revalidatePath("/admin/galeria");
  revalidatePath("/");
}

const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function extensionFromMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/avif") return "avif";
  return "jpg";
}

export async function uploadGalleryImageAction(formData: FormData) {
  const fileValue = formData.get("file");
  const altRaw = String(formData.get("altText") ?? "").trim();
  const altText = altRaw.length > 0 ? altRaw : undefined;

  if (!(fileValue instanceof File)) {
    throw new Error("Selecione uma imagem para upload");
  }
  if (!ACCEPTED_IMAGE_TYPES.has(fileValue.type)) {
    throw new Error("Formato inválido. Use JPG, PNG, WEBP ou AVIF");
  }
  if (fileValue.size === 0 || fileValue.size > MAX_IMAGE_BYTES) {
    throw new Error("Imagem deve ter até 5MB");
  }

  const ext = extensionFromMime(fileValue.type);
  const filename = `${Date.now()}-${randomUUID()}.${ext}`;
  const relativePath = `/uploads/galeria/${filename}`;
  const uploadDir = path.join(process.cwd(), "public", "uploads", "galeria");
  const absolutePath = path.join(uploadDir, filename);

  await mkdir(uploadDir, { recursive: true });
  const buffer = Buffer.from(await fileValue.arrayBuffer());
  await writeFile(absolutePath, buffer);

  await createGalleryImage({ imageUrl: relativePath, altText });
  revalidatePath("/admin/galeria");
  revalidatePath("/");
}

export async function deleteGalleryImageAction(payload: { galleryImageId: string; imageUrl?: string }) {
  await deleteGalleryImage(payload);

  if (payload.imageUrl?.startsWith("/uploads/galeria/")) {
    const absolutePath = path.join(process.cwd(), "public", payload.imageUrl);
    await unlink(absolutePath).catch(() => undefined);
  }

  revalidatePath("/admin/galeria");
  revalidatePath("/");
}

export async function isAdminAuthenticated() {
  const cookieStore = await cookies();
  return cookieStore.get(ADMIN_COOKIE)?.value === "ok";
}
