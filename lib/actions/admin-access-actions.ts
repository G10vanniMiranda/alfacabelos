"use server";

import { revalidatePath } from "next/cache";
import { createAdminAccessSchema, updateAdminAccessSchema } from "@/lib/validators/schemas";
import { createAdminAccess, deleteAdminAccess, updateAdminAccess } from "@/lib/auth/admin-access-store";
import { requireStaff } from "@/lib/auth/staff-auth";
import { ActionState } from "@/types/scheduler";

async function assertAdminSession() {
  await requireStaff(["ADMIN"]);
}

export async function createAdminAccessAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertAdminSession();

  const parsed = createAdminAccessSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
    role: String(formData.get("role") ?? "ADMIN"),
    barberId: String(formData.get("barberId") ?? "") || undefined,
  });

  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  try {
    await createAdminAccess({
      email: parsed.data.email,
      password: parsed.data.password,
      role: parsed.data.role,
      barberId: parsed.data.barberId,
    });
    revalidatePath("/admin/acessos");
    return { success: true, message: "Acesso administrativo criado com sucesso" };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Falha ao criar acesso administrativo",
    };
  }
}

export async function deleteAdminAccessAction(accessId: string): Promise<ActionState> {
  await assertAdminSession();

  if (!accessId) {
    return { success: false, message: "Acesso inválido" };
  }

  try {
    const deleted = await deleteAdminAccess(accessId);
    if (!deleted) {
      return { success: false, message: "Acesso não encontrado" };
    }

    revalidatePath("/admin/acessos");
    return { success: true, message: "Acesso removido" };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Falha ao remover acesso",
    };
  }
}

export async function updateAdminAccessAction(input: {
  accessId: string;
  email: string;
  password?: string;
  confirmPassword?: string;
  role?: "ADMIN" | "BARBER";
  barberId?: string;
}): Promise<ActionState> {
  await assertAdminSession();

  const parsed = updateAdminAccessSchema.safeParse({
    accessId: input.accessId,
    email: input.email,
    password: input.password ?? "",
    confirmPassword: input.confirmPassword ?? "",
    role: input.role ?? "ADMIN",
    barberId: input.barberId,
  });

  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  try {
    const updated = await updateAdminAccess({
      accessId: parsed.data.accessId,
      email: parsed.data.email,
      password: parsed.data.password.trim() || undefined,
      role: parsed.data.role,
      barberId: parsed.data.barberId,
    });

    if (!updated) {
      return { success: false, message: "Acesso não encontrado" };
    }

    revalidatePath("/admin/acessos");
    return { success: true, message: "Acesso atualizado com sucesso" };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Falha ao atualizar acesso",
    };
  }
}
