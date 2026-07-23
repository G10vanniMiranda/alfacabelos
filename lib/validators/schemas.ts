import { z } from "zod";
import { STANDARD_SERVICE_MAX_MINUTES } from "@/lib/scheduling-rules";

export const phoneSchema = z
  .string()
  .trim()
  .min(1, "Telefone é obrigatório")
  .refine((value) => {
    const digits = value.replace(/\D/g, "");
    const localDigits = digits.startsWith("55") && (digits.length === 12 || digits.length === 13)
      ? digits.slice(2)
      : digits;
    return localDigits.length === 10 || localDigits.length === 11;
  }, {
    message: "Telefone inválido. Informe DDD e número",
  });

const passwordSchema = z
  .string()
  .min(8, "Senha deve ter pelo menos 8 caracteres")
  .refine((value) => value === value.trim(), {
    message: "Senha não pode começar ou terminar com espaços",
  });

const passwordResetIdentifierSchema = z
  .string()
  .trim()
  .min(1, "Informe o telefone cadastrado")
  .max(32, "Telefone inválido")
  .refine((value) => {
    const digits = value.replace(/\D/g, "");
    const localDigits = digits.startsWith("55") && (digits.length === 12 || digits.length === 13)
      ? digits.slice(2)
      : digits;
    return localDigits.length >= 10 && localDigits.length <= 11;
  }, {
    message: "Telefone inválido. Use DDD + número",
  });

export const createBookingSchema = z.object({
  serviceId: z.string().min(1, "Serviço é obrigatório"),
  barberId: z.string().min(1, "Barbeiro é obrigatório").optional(),
  start: z.string().datetime("Data/hora inválida"),
  customerName: z.string().trim().min(2, "Informe o nome completo"),
  customerPhone: phoneSchema,
  observations: z.string().trim().max(500, "Observações devem ter até 500 caracteres").optional(),
});

export const clientRegisterSchema = z
  .object({
    name: z.string().trim().min(2, "Nome é obrigatório"),
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
  password: z.string().min(1, "Senha é obrigatória"),
});

export const requestPasswordResetSchema = z.object({
  identifier: passwordResetIdentifierSchema,
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
  email: z.string().trim().email("E-mail inválido"),
  password: z.string().min(1, "Senha obrigatória"),
});

export const createAdminAccessSchema = z
  .object({
    email: z.string().trim().email("E-mail inválido"),
    password: z.string().min(8, "Senha deve ter pelo menos 8 caracteres"),
    confirmPassword: z.string().min(8, "Confirme a senha"),
    role: z.enum(["ADMIN", "BARBER"]).default("ADMIN"),
    barberId: z.string().optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não conferem",
    path: ["confirmPassword"],
  });

export const updateBookingStatusSchema = z.object({
  bookingId: z.string().min(1),
  status: z.enum(["PENDENTE", "CONFIRMADO", "CANCELADO", "CONCLUIDO", "AUSENTE"]),
});

export const updateBookingPaymentStatusSchema = z.object({
  bookingId: z.string().min(1),
  paymentStatus: z.enum(["PENDENTE", "CONFIRMADO"]),
});

export const updateAdminBookingSchema = z.object({
  bookingId: z.string().min(1, "Agendamento inválido"),
  serviceId: z.string().min(1, "Serviço é obrigatório"),
  barberId: z.string().min(1, "Barbeiro é obrigatório"),
  customerName: z.string().trim().min(2, "Informe o nome do cliente"),
  customerPhone: phoneSchema,
  observations: z.string().trim().max(500, "Observações devem ter até 500 caracteres").optional(),
  start: z.string().datetime("Data/hora inválida"),
});

export const createAdminBookingSchema = z
  .object({
    serviceId: z.string().min(1, "Serviço é obrigatório"),
    barberId: z.string().min(1, "Barbeiro é obrigatório"),
    customerName: z.string().trim().min(2, "Informe o nome do cliente"),
    customerPhone: phoneSchema,
    observations: z.string().trim().max(500, "Observações devem ter até 500 caracteres").optional(),
    start: z.string().datetime("Data/hora inválida"),
    starts: z.array(z.string().datetime("Data/hora inválida")).min(1).max(59).optional(),
    recurrence: z.enum(["NONE", "DAILY", "WEEKLY", "MONTHLY"]),
    repeatUntil: z.string().optional(),
    interval: z.number().int().min(1).max(52).optional(),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    idempotencyKey: z.string().trim().min(16).max(128).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.recurrence === "NONE") {
      return;
    }

    if (!data.idempotencyKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Chave de idempotência obrigatória para recorrência",
        path: ["idempotencyKey"],
      });
      return;
    }

    if (data.starts && data.starts.length >= 60) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Limite de 59 repetições por criação. Reduza o período.",
        path: ["starts"],
      });
      return;
    }

    const repeatUntil = data.repeatUntil?.trim() ?? "";
    if (!repeatUntil) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe até quando repetir",
        path: ["repeatUntil"],
      });
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(repeatUntil)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Data final inválida",
        path: ["repeatUntil"],
      });
      return;
    }

    const startDate = new Date(data.start);
    const untilDate = new Date(`${repeatUntil}T23:59:59`);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(untilDate.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Data final inválida",
        path: ["repeatUntil"],
      });
      return;
    }

    if (untilDate < startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A repetição deve terminar depois do primeiro agendamento",
        path: ["repeatUntil"],
      });
    }
  });

export const updateAdminAccessSchema = z
  .object({
    accessId: z.string().min(1, "Acesso inválido"),
    email: z.string().trim().email("E-mail inválido"),
    password: z.string(),
    confirmPassword: z.string(),
    role: z.enum(["ADMIN", "BARBER"]).default("ADMIN"),
    barberId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const password = data.password.trim();
    const confirmPassword = data.confirmPassword.trim();

    if (!password && !confirmPassword) {
      return;
    }

    if (password.length < 8) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Senha deve ter pelo menos 8 caracteres",
        path: ["password"],
      });
    }

    if (confirmPassword.length < 8) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Confirme a senha com pelo menos 8 caracteres",
        path: ["confirmPassword"],
      });
    }

    if (password !== confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "As senhas não conferem",
        path: ["confirmPassword"],
      });
    }
  });

export const createBlockedSlotSchema = z.object({
  barberId: z.string().optional(),
  dateTimeStart: z.string().datetime("Início inválido"),
  dateTimeEnd: z.string().datetime("Fim inválido"),
  reason: z.string().trim().min(2, "Motivo é obrigatório"),
});

export const deleteBlockedSlotSchema = z.object({
  blockedSlotId: z.string().min(1),
});

const timeStringRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const replaceBarberDayAvailabilitySchema = z
  .object({
    barberId: z.string().min(1, "Barbeiro é obrigatório"),
    dayOfWeek: z.number().int().min(0).max(6),
    ranges: z.array(
      z
        .object({
          openTime: z.string().regex(timeStringRegex, "Horário inicial inválido"),
          closeTime: z.string().regex(timeStringRegex, "Horário final inválido"),
        })
        .refine((data) => data.openTime < data.closeTime, {
          message: "Horário final deve ser maior que o inicial",
          path: ["closeTime"],
        }),
    ),
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
  name: z.string().trim().min(2, "Nome do serviço é obrigatório"),
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
  serviceId: z.string().min(1, "Serviço inválido"),
}).refine(
  (data) => data.isProcedure || data.durationMinutes <= STANDARD_SERVICE_MAX_MINUTES,
  standardServiceDurationRule,
);

export const createGalleryImageSchema = z.object({
  imageUrl: z
    .string()
    .trim()
    .url("Informe uma URL válida para a mídia"),
  altText: z.string().trim().max(120, "Texto alternativo muito longo").optional(),
  mediaType: z.enum(["IMAGE", "VIDEO"]).optional(),
});

export const deleteGalleryImageSchema = z.object({
  galleryImageId: z.string().min(1, "Foto inválida"),
});
