"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createAdminAccessSchema } from "@/lib/validators/schemas";
import { countAdminAccesses, createAdminAccess, deleteAdminAccess } from "@/lib/auth/admin-access-store";
import { isAdminSessionTokenValid } from "@/lib/auth/admin-session-store";
import { ActionState } from "@/types/scheduler";

const ADMIN_COOKIE = "barber_admin";

async function assertAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE)?.value ?? "";
  const authorized = await isAdminSessionTokenValid(token);
  if (!authorized) {
    throw new Error("Não autorizado");
  }
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
  });

  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  try {
    await createAdminAccess({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    revalidatePath("/admin/acessos");
    return { success: true, message: "Acesso admin criado com sucesso" };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Falha ao criar acesso admin",
    };
  }
}

export async function deleteAdminAccessAction(accessId: string): Promise<ActionState> {
  await assertAdminSession();

  if (!accessId) {
    return { success: false, message: "Acesso invalido" };
  }

  try {
    const total = await countAdminAccesses();
    if (total <= 1) {
      return {
        success: false,
        message: "Mantenha pelo menos um acesso admin cadastrado",
      };
    }

    const deleted = await deleteAdminAccess(accessId);
    if (!deleted) {
      return { success: false, message: "Acesso nao encontrado" };
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
