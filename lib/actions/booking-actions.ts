"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  createService,
  createBlockedSlot,
  createBooking,
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

export async function isAdminAuthenticated() {
  const cookieStore = await cookies();
  return cookieStore.get(ADMIN_COOKIE)?.value === "ok";
}

