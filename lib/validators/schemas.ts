import { z } from "zod";

export const phoneSchema = z
  .string()
  .trim()
  .min(10, "Telefone e obrigatorio")
  .refine((value) => /^\(?\d{2}\)?\s?\d{4,5}-?\d{4}$/.test(value), {
    message: "Telefone invalido. Use formato (11) 99999-9999",
  });

export const createBookingSchema = z.object({
  serviceId: z.string().min(1, "Servico e obrigatorio"),
  barberId: z.string().min(1, "Barbeiro e obrigatorio"),
  start: z.string().datetime("Data/hora invalida"),
  customerName: z.string().trim().min(2, "Informe o nome completo"),
  customerPhone: phoneSchema,
});

export const clientRegisterSchema = z
  .object({
    name: z.string().trim().min(2, "Nome e obrigatorio"),
    phone: phoneSchema,
    password: z.string().min(6, "Senha deve ter pelo menos 6 caracteres"),
    confirmPassword: z.string().min(6, "Confirmacao obrigatoria"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas nao conferem",
    path: ["confirmPassword"],
  });

export const clientLoginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, "Senha e obrigatoria"),
});

export const adminLoginSchema = z.object({
  password: z.string().min(1, "Senha e obrigatoria"),
});

export const updateBookingStatusSchema = z.object({
  bookingId: z.string().min(1),
  status: z.enum(["PENDENTE", "CONFIRMADO", "CANCELADO"]),
});

export const createBlockedSlotSchema = z.object({
  barberId: z.string().optional(),
  dateTimeStart: z.string().datetime("Inicio invalido"),
  dateTimeEnd: z.string().datetime("Fim invalido"),
  reason: z.string().trim().min(2, "Motivo e obrigatorio"),
});

export const deleteBlockedSlotSchema = z.object({
  blockedSlotId: z.string().min(1),
});
