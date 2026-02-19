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
    .url("Informe uma URL válida para a foto"),
  altText: z.string().trim().max(120, "Texto alternativo muito longo").optional(),
});

export const deleteGalleryImageSchema = z.object({
  galleryImageId: z.string().min(1, "Foto inválida"),
});
