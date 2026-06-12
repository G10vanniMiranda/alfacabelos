import { z } from "zod";

export const phoneSchema = z
  .string()
  .trim()
  .min(10, "Telefone e obrigatorio")
  .refine((value) => /^\(?\d{2}\)?\s?\d{4,5}-?\d{4}$/.test(value), {
    message: "Telefone invalido. Use formato (11) 99999-9999",
  });

export const createBookingSchema = z.object({
  serviceId: z.string().min(1, "Serviço é obrigatório"),
  barberId: z.string().min(1, "Barbeiro é obrigatório").optional(),
  start: z.string().datetime("Data/hora inválida"),
  customerName: z.string().trim().min(2, "Informe o nome completo"),
  customerPhone: phoneSchema,
  observations: z.string().trim().max(500, "Observacoes devem ter ate 500 caracteres").optional(),
});

export const clientRegisterSchema = z
  .object({
    name: z.string().trim().min(2, "Nome é obrigatório"),
    phone: phoneSchema,
    password: z.string().min(6, "Senha deve ter pelo menos 6 caracteres"),
    confirmPassword: z.string().min(6, "Confirmação obrigatória"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não conferem",
    path: ["confirmPassword"],
  });

export const clientLoginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, "Senha é obrigatória"),
});

export const adminLoginSchema = z.object({
  email: z.string().trim().email("Email inválido"),
  password: z.string().min(1, "Senha obrigatória"),
});

export const createAdminAccessSchema = z
  .object({
    email: z.string().trim().email("Email inválido"),
    password: z.string().min(8, "Senha deve ter pelo menos 8 caracteres"),
    confirmPassword: z.string().min(8, "Confirme a senha"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não conferem",
    path: ["confirmPassword"],
  });

export const updateBookingStatusSchema = z.object({
  bookingId: z.string().min(1),
  status: z.enum(["PENDENTE", "CONFIRMADO", "CANCELADO"]),
});

export const updateBookingPaymentStatusSchema = z.object({
  bookingId: z.string().min(1),
  paymentStatus: z.enum(["PENDENTE", "CONFIRMADO"]),
});

export const updateAdminBookingSchema = z.object({
  bookingId: z.string().min(1, "Agendamento invalido"),
  serviceId: z.string().min(1, "Servico e obrigatorio"),
  barberId: z.string().min(1, "Barbeiro e obrigatorio"),
  customerName: z.string().trim().min(2, "Informe o nome do cliente"),
  customerPhone: phoneSchema,
  observations: z.string().trim().max(500, "Observacoes devem ter ate 500 caracteres").optional(),
  start: z.string().datetime("Data/hora invalida"),
});

export const createAdminBookingSchema = z
  .object({
    serviceId: z.string().min(1, "Servico e obrigatorio"),
    barberId: z.string().min(1, "Barbeiro e obrigatorio"),
    customerName: z.string().trim().min(2, "Informe o nome do cliente"),
    customerPhone: phoneSchema,
    observations: z.string().trim().max(500, "Observacoes devem ter ate 500 caracteres").optional(),
    start: z.string().datetime("Data/hora invalida"),
    starts: z.array(z.string().datetime("Data/hora invalida")).min(1).max(59).optional(),
    recurrence: z.enum(["NONE", "DAILY", "WEEKLY", "MONTHLY"]),
    repeatUntil: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.recurrence === "NONE") {
      return;
    }

    if (data.starts && data.starts.length >= 60) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Limite de 59 repeticoes por criacao. Reduza o periodo.",
        path: ["starts"],
      });
      return;
    }

    const repeatUntil = data.repeatUntil?.trim() ?? "";
    if (!repeatUntil) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe ate quando repetir",
        path: ["repeatUntil"],
      });
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(repeatUntil)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Data final invalida",
        path: ["repeatUntil"],
      });
      return;
    }

    const startDate = new Date(data.start);
    const untilDate = new Date(`${repeatUntil}T23:59:59`);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(untilDate.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Data final invalida",
        path: ["repeatUntil"],
      });
      return;
    }

    if (untilDate < startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A repeticao deve terminar depois do primeiro agendamento",
        path: ["repeatUntil"],
      });
    }
  });

export const updateAdminAccessSchema = z
  .object({
    accessId: z.string().min(1, "Acesso invalido"),
    email: z.string().trim().email("Email invalido"),
    password: z.string(),
    confirmPassword: z.string(),
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
        message: "As senhas nao conferem",
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
    barberId: z.string().min(1, "Barbeiro e obrigatorio"),
    dayOfWeek: z.number().int().min(0).max(6),
    ranges: z.array(
      z
        .object({
          openTime: z.string().regex(timeStringRegex, "Horario inicial invalido"),
          closeTime: z.string().regex(timeStringRegex, "Horario final invalido"),
        })
        .refine((data) => data.openTime < data.closeTime, {
          message: "Horario final deve ser maior que o inicial",
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
    message: "As faixas de horario nao podem se sobrepor",
    path: ["ranges"],
  });

export const createServiceSchema = z.object({
  name: z.string().trim().min(2, "Nome do serviço é obrigatório"),
  priceCents: z.number().int().positive("Preço deve ser maior que zero"),
});

export const updateServiceSchema = z.object({
  serviceId: z.string().min(1, "Serviço inválido"),
  name: z.string().trim().min(2, "Nome do serviço é obrigatório"),
  priceCents: z.number().int().positive("Preço deve ser maior que zero"),
});

export const createGalleryImageSchema = z.object({
  imageUrl: z
    .string()
    .trim()
    .url("Informe uma URL valida para a midia"),
  altText: z.string().trim().max(120, "Texto alternativo muito longo").optional(),
  mediaType: z.enum(["IMAGE", "VIDEO"]).optional(),
});

export const deleteGalleryImageSchema = z.object({
  galleryImageId: z.string().min(1, "Foto inválida"),
});
