"use server";

import { cookies, headers } from "next/headers";
import { after } from "next/server";
import {
  completeRecovery,
  issueRecoveryChallenge,
  RECOVERY_RESEND_COOLDOWN_SECONDS,
  requestRecoveryCode,
  verifyRecoveryCode,
} from "@/lib/auth/password-recovery";
import { createRecoveryDependencies } from "@/lib/auth/password-recovery-store";
import { RECOVERY_CODE_TTL_MINUTES } from "@/lib/auth/password-recovery-crypto";
import { deliverNotificationNow } from "@/lib/notifications/service";
import { requestIdFromHeaders } from "@/lib/observability/context";
import { logger } from "@/lib/observability/logger";
import { getClientIpFromHeaders } from "@/lib/security";
import { recoveryCodeSchema, recoveryPasswordSchema, requestPasswordResetSchema } from "@/lib/validators/schemas";
import type { RecoveryState } from "@/components/client/password-recovery-steps";

const RECOVERY_COOKIE = "alfa_pwd_recovery";
// Every step posts to this page, so the handle never travels to any other route.
const RECOVERY_COOKIE_PATH = "/esqueci-minha-senha";
const CLIENT_COOKIE = "barber_client";
const TEMPORARY_FAILURE = "Não foi possível concluir agora. Tente novamente em alguns instantes.";

async function setRecoveryCookie(handle: string) {
  (await cookies()).set(RECOVERY_COOKIE, handle, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: RECOVERY_COOKIE_PATH,
    maxAge: RECOVERY_CODE_TTL_MINUTES * 60,
  });
}

async function readRecoveryCookie(): Promise<string> {
  return (await cookies()).get(RECOVERY_COOKIE)?.value ?? "";
}

async function requestContext() {
  const requestHeaders = await headers();
  return { requestId: requestIdFromHeaders(requestHeaders), ip: getClientIpFromHeaders(requestHeaders) };
}

export async function requestRecoveryCodeAction(_prev: RecoveryState, formData: FormData): Promise<RecoveryState> {
  const phone = String(formData.get("phone") ?? "");
  const parsed = requestPasswordResetSchema.safeParse({ identifier: phone });
  if (!parsed.success) {
    return { step: "phone", status: "error", message: parsed.error.issues[0]?.message ?? "Telefone inválido", phone };
  }

  try {
    const { requestId, ip } = await requestContext();
    const deps = createRecoveryDependencies();
    const result = await requestRecoveryCode(deps, { phone: parsed.data.identifier, ip, requestId });
    if (result.outcome === "unavailable") {
      return {
        step: "phone", status: "unavailable", phone,
        message: "No momento não conseguimos enviar códigos de recuperação. Tente novamente mais tarde ou fale com a barbearia.",
      };
    }
    if (result.outcome === "rate_limited") {
      return {
        step: (await readRecoveryCookie()) ? "code" : "phone", status: "rate_limited", phone,
        message: `Aguarde ${result.retryAfterSeconds} segundos para pedir um novo código.`,
        retryAfterSeconds: result.retryAfterSeconds, cooldownStartedAt: Date.now(),
      };
    }

    await setRecoveryCookie(result.handle);
    // After the response: account lookup, challenge creation and provider latency must not
    // change how long this answer takes, or timing would reveal whether the phone exists.
    after(async () => {
      try {
        const deliveryId = await issueRecoveryChallenge(deps, { phone: parsed.data.identifier, handle: result.handle, requestId });
        if (deliveryId) await deliverNotificationNow(deliveryId);
      } catch (error) {
        logger.error("password_recovery.issue_failed", { requestId, error });
      }
    });
    return {
      step: "code", status: "sent", phone,
      message: "Se este telefone estiver cadastrado, você receberá um código de 8 números pelo WhatsApp em instantes.",
      retryAfterSeconds: RECOVERY_RESEND_COOLDOWN_SECONDS, cooldownStartedAt: Date.now(),
    };
  } catch (error) {
    logger.error("password_recovery.request_failed", { error });
    return { step: "phone", status: "error", message: TEMPORARY_FAILURE, phone };
  }
}

export async function verifyRecoveryCodeAction(prev: RecoveryState, formData: FormData): Promise<RecoveryState> {
  const base = { phone: prev.phone };
  const parsed = recoveryCodeSchema.safeParse({ code: String(formData.get("code") ?? "") });
  if (!parsed.success) {
    return { ...base, step: "code", status: "invalid", message: parsed.error.issues[0]?.message ?? "Código inválido" };
  }

  try {
    const { requestId, ip } = await requestContext();
    const handle = await readRecoveryCookie();
    const result = await verifyRecoveryCode(createRecoveryDependencies(), { handle, code: parsed.data.code, ip, requestId });
    switch (result.outcome) {
      case "verified":
        await setRecoveryCookie(handle);
        return { ...base, step: "password", status: "verified", message: "Código confirmado. Agora crie sua nova senha." };
      case "invalid":
        return { ...base, step: "code", status: "invalid", message: "Código incorreto. Confira os 8 números e tente novamente." };
      case "locked":
        return { ...base, step: "code", status: "locked", message: "Muitas tentativas incorretas. Por segurança, peça um novo código." };
      case "rate_limited":
        return { ...base, step: "code", status: "rate_limited", message: `Muitas tentativas. Aguarde ${Math.ceil(result.retryAfterSeconds / 60)} minuto(s).` };
      default:
        return { ...base, step: "code", status: "expired", message: "Este código expirou ou não é mais válido. Peça um novo código." };
    }
  } catch (error) {
    logger.error("password_recovery.verify_failed", { error });
    return { ...base, step: "code", status: "error", message: TEMPORARY_FAILURE };
  }
}

export async function completeRecoveryAction(prev: RecoveryState, formData: FormData): Promise<RecoveryState> {
  const parsed = recoveryPasswordSchema.safeParse({
    password: String(formData.get("password") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  });
  if (!parsed.success) {
    return { step: "password", status: "error", message: parsed.error.issues[0]?.message ?? "Senha inválida" };
  }

  try {
    const { requestId } = await requestContext();
    const result = await completeRecovery(createRecoveryDependencies(), {
      handle: await readRecoveryCookie(), password: parsed.data.password, requestId,
    });
    if (result.outcome !== "completed") {
      return { step: "phone", status: "expired", phone: prev.phone, message: "Sua verificação expirou. Peça um novo código para continuar." };
    }
    const cookieStore = await cookies();
    cookieStore.delete({ name: RECOVERY_COOKIE, path: RECOVERY_COOKIE_PATH });
    cookieStore.delete(CLIENT_COOKIE);
    return { step: "done", status: "completed", message: "Senha definida com sucesso. Entre com o seu telefone e a nova senha." };
  } catch (error) {
    logger.error("password_recovery.complete_failed", { error });
    return { step: "password", status: "error", message: TEMPORARY_FAILURE };
  }
}
