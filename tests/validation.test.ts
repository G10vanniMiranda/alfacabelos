import test from "node:test";
import assert from "node:assert/strict";
import { clientLoginSchema, createServiceSchema, phoneSchema } from "@/lib/validators/schemas";
import { normalizeClientPhone } from "@/lib/auth/client-store";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp";

test("normaliza telefones brasileiros para DDI 55", () => {
  assert.equal(normalizeWhatsAppPhone("(69) 99999-9999"), "5569999999999");
  assert.equal(normalizeWhatsAppPhone("+55 69 99999-9999"), "5569999999999");
  assert.equal(normalizeWhatsAppPhone("123"), null);
});

test("aceita telefone de cliente com máscara e normaliza DDI opcional", () => {
  assert.equal(phoneSchema.safeParse("(69) 99999-9999").success, true);
  assert.equal(phoneSchema.safeParse("+55 69 99999-9999").success, true);
  assert.equal(phoneSchema.safeParse("(69) 3333-4444").success, true);
  assert.equal(phoneSchema.safeParse("(69) 9999-99").success, false);
  assert.equal(normalizeClientPhone("+55 69 99999-9999"), "69999999999");
  assert.equal(clientLoginSchema.safeParse({ phone: "(69) 99999-9999", password: "senha" }).success, true);
});

test("valida limites de duração do serviço", () => {
  assert.equal(createServiceSchema.safeParse({ name: "Corte", priceCents: 4500, durationMinutes: 45 }).success, true);
  assert.equal(createServiceSchema.safeParse({ name: "Serviço longo", priceCents: 9000, durationMinutes: 75 }).success, false);
  assert.equal(createServiceSchema.safeParse({ name: "Procedimento", priceCents: 9000, durationMinutes: 75, isProcedure: true }).success, true);
  assert.equal(createServiceSchema.safeParse({ name: "Corte", priceCents: 4500, durationMinutes: 10 }).success, false);
  assert.equal(createServiceSchema.safeParse({ name: "Corte", priceCents: 4500, durationMinutes: 300 }).success, false);
});
