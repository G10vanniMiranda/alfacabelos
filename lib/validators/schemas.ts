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
  password: z.string().min(1, "Senha é obrigatória"),
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

export const createServiceSchema = z.object({
  name: z.string().trim().min(2, "Nome do serviço é obrigatório"),
  priceCents: z.number().int().positive("Preço deve ser maior que zero"),
});

export const updateServiceSchema = z.object({
  serviceId: z.string().min(1, "Serviço inválido"),
  name: z.string().trim().min(2, "Nome do serviço é obrigatório"),
  priceCents: z.number().int().positive("Preço deve ser maior que zero"),
});
