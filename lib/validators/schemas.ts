import { z } from "zod";
import { STANDARD_SERVICE_MAX_MINUTES } from "@/lib/scheduling-rules";
import { normalizeBrazilPhone } from "@/lib/phone";

// Upper bounds keep every Server Action/API payload field small (Server Actions accept up to 6 MB).
const MAX_ID = 128;
const MAX_NAME = 120;
const MAX_EMAIL = 254;
const MAX_PASSWORD = 256;
export const MAX_AVAILABILITY_RANGES_PER_DAY = 24;

const idSchema = (message?: string) => z.string().min(1, message).max(MAX_ID, message ?? "Identificador inválido");
const emailSchema = z.string().trim().max(MAX_EMAIL, "E-mail inválido").email("E-mail inválido");

export const phoneSchema = z
  .string()
  .trim()
  .min(1, "Telefone é obrigatório")
  .max(32, "Telefone inválido. Informe DDD e número")
  .refine((value) => Boolean(normalizeBrazilPhone(value)), {
    message: "Telefone inválido. Informe DDD e número",
  });

const passwordSchema = z
  .string()
  .min(8, "Senha deve ter pelo menos 8 caracteres")
  .max(MAX_PASSWORD, `Senha deve ter no máximo ${MAX_PASSWORD} caracteres`)
  .refine((value) => value === value.trim(), {
    message: "Senha não pode começar ou terminar com espaços",
  });

const passwordResetIdentifierSchema = z
  .string()
  .trim()
  .min(1, "Informe o telefone cadastrado")
  .max(32, "Telefone inválido")
  .refine((value) => Boolean(normalizeBrazilPhone(value)), {
    message: "Telefone inválido. Use DDD + número",
  });

export const createBookingSchema = z.object({
  serviceId: idSchema("Serviço é obrigatório"),
  barberId: idSchema("Barbeiro é obrigatório").optional(),
  start: z.string().datetime("Data/hora inválida"),
  customerName: z.string().trim().min(2, "Informe o nome completo").max(MAX_NAME, "Nome muito longo"),
  customerPhone: phoneSchema,
  observations: z.string().trim().max(500, "Observações devem ter até 500 caracteres").optional(),
});

export const clientRegisterSchema = z
  .object({
    name: z.string().trim().min(2, "Nome é obrigatório").max(MAX_NAME, "Nome muito longo"),
    phone: phoneSchema,
    password: passwordSchema,
    confirmPassword: passwordSchema,
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não conferem",
    path: ["confirmPassword"],
  });

export const clientLoginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, "Senha é obrigatória").max(MAX_PASSWORD, "Senha inválida"),
});

export const requestPasswordResetSchema = z.object({
  identifier: passwordResetIdentifierSchema,
});

export const recoveryCodeSchema = z.object({
  code: z
    .string()
    .max(32, "Digite os 8 números do código")
    .transform((value) => value.replace(/[\s-]/g, ""))
    .refine((value) => /^\d{8}$/.test(value), { message: "Digite os 8 números do código" }),
});

export const recoveryPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: passwordSchema,
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não conferem",
    path: ["confirmPassword"],
  });

export const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(16, "Token inválido").max(256, "Token inválido"),
    password: passwordSchema,
    confirmPassword: passwordSchema,
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não conferem",
    path: ["confirmPassword"],
  });

export const adminLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Senha obrigatória").max(MAX_PASSWORD, "Senha inválida"),
});

export const createAdminAccessSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(8, "Senha deve ter pelo menos 8 caracteres").max(MAX_PASSWORD, `Senha deve ter no máximo ${MAX_PASSWORD} caracteres`),
    confirmPassword: z.string().min(8, "Confirme a senha").max(MAX_PASSWORD, `Senha deve ter no máximo ${MAX_PASSWORD} caracteres`),
    role: z.enum(["ADMIN", "BARBER"]).default("ADMIN"),
    barberId: z.string().max(MAX_ID, "Barbeiro inválido").optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não conferem",
    path: ["confirmPassword"],
  });

export const updateBookingStatusSchema = z.object({
  bookingId: idSchema(),
  status: z.enum(["PENDENTE", "CONFIRMADO", "CANCELADO", "CONCLUIDO", "AUSENTE"]),
});

export const updateBookingPaymentStatusSchema = z.object({
  bookingId: idSchema(),
  paymentStatus: z.enum(["PENDENTE", "CONFIRMADO"]),
});

export const updateAdminBookingSchema = z.object({
  bookingId: idSchema("Agendamento inválido"),
  serviceId: idSchema("Serviço é obrigatório"),
  barberId: idSchema("Barbeiro é obrigatório"),
  customerName: z.string().trim().min(2, "Informe o nome do cliente").max(MAX_NAME, "Nome muito longo"),
  customerPhone: phoneSchema,
  observations: z.string().trim().max(500, "Observações devem ter até 500 caracteres").optional(),
  start: z.string().datetime("Data/hora inválida"),
});

export const createAdminBookingSchema = z
  .object({
    serviceId: idSchema("Serviço é obrigatório"),
    barberId: idSchema("Barbeiro é obrigatório"),
    customerName: z.string().trim().min(2, "Informe o nome do cliente").max(MAX_NAME, "Nome muito longo"),
    customerPhone: phoneSchema,
    observations: z.string().trim().max(500, "Observações devem ter até 500 caracteres").optional(),
    start: z.string().datetime("Data/hora inválida"),
    starts: z.array(z.string().datetime("Data/hora inválida")).min(1).max(59, "Limite de 59 repetições por criação. Reduza o período.").optional(),
    recurrence: z.enum(["NONE", "DAILY", "WEEKLY", "MONTHLY"]),
    repeatUntil: z.string().max(32, "Data final inválida").optional(),
    interval: z.number().int().min(1).max(52).optional(),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    idempotencyKey: z.string().trim().min(16).max(128).optional(),
    rescheduleBookingId: idSchema("Agendamento inválido").optional(),
  })
  .superRefine((data, ctx) => {
    if (data.recurrence === "NONE") {
      return;
    }

    if (!data.idempotencyKey) {
      ctx.addIssue({
        code: "custom",
        message: "Chave de idempotência obrigatória para recorrência",
        path: ["idempotencyKey"],
      });
      return;
    }

    if (data.starts && data.starts.length >= 60) {
      ctx.addIssue({
        code: "custom",
        message: "Limite de 59 repetições por criação. Reduza o período.",
        path: ["starts"],
      });
      return;
    }

    const repeatUntil = data.repeatUntil?.trim() ?? "";
    if (!repeatUntil) {
      ctx.addIssue({
        code: "custom",
        message: "Informe até quando repetir",
        path: ["repeatUntil"],
      });
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(repeatUntil)) {
      ctx.addIssue({
        code: "custom",
        message: "Data final inválida",
        path: ["repeatUntil"],
      });
      return;
    }

    const startDate = new Date(data.start);
    const untilDate = new Date(`${repeatUntil}T23:59:59`);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(untilDate.getTime())) {
      ctx.addIssue({
        code: "custom",
        message: "Data final inválida",
        path: ["repeatUntil"],
      });
      return;
    }

    if (untilDate < startDate) {
      ctx.addIssue({
        code: "custom",
        message: "A repetição deve terminar depois do primeiro agendamento",
        path: ["repeatUntil"],
      });
    }
  });

export const updateAdminAccessSchema = z
  .object({
    accessId: idSchema("Acesso inválido"),
    email: emailSchema,
    password: z.string().max(MAX_PASSWORD, `Senha deve ter no máximo ${MAX_PASSWORD} caracteres`),
    confirmPassword: z.string().max(MAX_PASSWORD, `Senha deve ter no máximo ${MAX_PASSWORD} caracteres`),
    role: z.enum(["ADMIN", "BARBER"]).default("ADMIN"),
    barberId: z.string().max(MAX_ID, "Barbeiro inválido").optional(),
  })
  .superRefine((data, ctx) => {
    const password = data.password.trim();
    const confirmPassword = data.confirmPassword.trim();

    if (!password && !confirmPassword) {
      return;
    }

    if (password.length < 8) {
      ctx.addIssue({
        code: "custom",
        message: "Senha deve ter pelo menos 8 caracteres",
        path: ["password"],
      });
    }

    if (confirmPassword.length < 8) {
      ctx.addIssue({
        code: "custom",
        message: "Confirme a senha com pelo menos 8 caracteres",
        path: ["confirmPassword"],
      });
    }

    if (password !== confirmPassword) {
      ctx.addIssue({
        code: "custom",
        message: "As senhas não conferem",
        path: ["confirmPassword"],
      });
    }
  });

export const createBlockedSlotSchema = z.object({
  barberId: z.string().max(MAX_ID, "Barbeiro inválido").optional(),
  dateTimeStart: z.string().datetime("Início inválido"),
  dateTimeEnd: z.string().datetime("Fim inválido"),
  reason: z.string().trim().min(2, "Motivo é obrigatório").max(200, "Motivo deve ter até 200 caracteres"),
});

export const deleteBlockedSlotSchema = z.object({
  blockedSlotId: idSchema(),
});

const timeStringRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const replaceBarberDayAvailabilitySchema = z
  .object({
    barberId: idSchema("Barbeiro é obrigatório"),
    dayOfWeek: z.number().int().min(0).max(6),
    ranges: z
      .array(
        z
          .object({
            openTime: z.string().regex(timeStringRegex, "Horário inicial inválido"),
            closeTime: z.string().regex(timeStringRegex, "Horário final inválido"),
          })
          .refine((data) => data.openTime < data.closeTime, {
            message: "Horário final deve ser maior que o inicial",
            path: ["closeTime"],
          }),
      )
      .max(MAX_AVAILABILITY_RANGES_PER_DAY, `Limite de ${MAX_AVAILABILITY_RANGES_PER_DAY} faixas de horário por dia`),
  })
  .refine((data) => {
    const sorted = [...data.ranges].sort((a, b) => a.openTime.localeCompare(b.openTime));
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i - 1] && sorted[i - 1].closeTime > sorted[i].openTime) {
        return false;
      }
    }
    return true;
  }, {
    message: "As faixas de horário não podem se sobrepor",
    path: ["ranges"],
  });

const serviceFieldsSchema = z.object({
  name: z.string().trim().min(2, "Nome do serviço é obrigatório").max(MAX_NAME, "Nome do serviço muito longo"),
  priceCents: z.number().int().positive("Preço deve ser maior que zero"),
  durationMinutes: z.number().int().min(15, "Duração mínima de 15 minutos").max(240, "Duração máxima de 240 minutos"),
  isProcedure: z.boolean().default(false),
});

const standardServiceDurationRule = {
  message: `Serviços comuns podem durar no máximo ${STANDARD_SERVICE_MAX_MINUTES} minutos`,
  path: ["durationMinutes"],
};

export const createServiceSchema = serviceFieldsSchema.refine(
  (data) => data.isProcedure || data.durationMinutes <= STANDARD_SERVICE_MAX_MINUTES,
  standardServiceDurationRule,
);

export const updateServiceSchema = serviceFieldsSchema.extend({
  serviceId: idSchema("Serviço inválido"),
}).refine(
  (data) => data.isProcedure || data.durationMinutes <= STANDARD_SERVICE_MAX_MINUTES,
  standardServiceDurationRule,
);

export const createGalleryImageSchema = z.object({
  imageUrl: z
    .string()
    .trim()
    .max(2048, "URL da mídia muito longa")
    .url("Informe uma URL válida para a mídia"),
  altText: z.string().trim().max(120, "Texto alternativo muito longo").optional(),
  mediaType: z.enum(["IMAGE", "VIDEO"]).optional(),
});

export const deleteGalleryImageSchema = z.object({
  galleryImageId: idSchema("Foto inválida"),
});
