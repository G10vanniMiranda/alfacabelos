import assert from "node:assert/strict";
import test from "node:test";
import {
  getBrazilPhoneLookupCandidates,
  normalizeBrazilPhone,
} from "../lib/phone";
import {
  createPasswordResetToken,
  evaluatePasswordResetToken,
  hashPasswordResetToken,
  PASSWORD_RESET_TOKEN_TTL_MINUTES,
} from "../lib/auth/password-reset-security";
import { resetPasswordSchema } from "../lib/validators/schemas";
import { buildPasswordResetLink } from "../lib/auth/client-password-reset-store";

test("normaliza todos os formatos aceitos de telefone para uma identidade unica", () => {
  for (const input of [
    "(69) 99350-3633",
    "69993503633",
    "+5569993503633",
    "5569993503633",
  ]) {
    assert.deepEqual(normalizeBrazilPhone(input), {
      national: "69993503633",
      e164: "5569993503633",
    });
    assert.deepEqual(getBrazilPhoneLookupCandidates(input), ["69993503633", "5569993503633"]);
  }
  assert.equal(normalizeBrazilPhone("123"), null);
  assert.equal(normalizeBrazilPhone("+1 202 555 0100"), null);
});

test("gera token opaco forte, persiste hash deterministico e expira em 30 minutos", () => {
  const now = new Date("2026-09-22T12:00:00.000Z");
  const first = createPasswordResetToken(now);
  const second = createPasswordResetToken(now);

  assert.match(first.rawToken, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.rawToken, second.rawToken);
  assert.equal(first.tokenHash, hashPasswordResetToken(first.rawToken));
  assert.notEqual(first.tokenHash, first.rawToken);
  assert.equal(first.expiresAt.toISOString(), "2026-09-22T12:30:00.000Z");
  assert.equal(PASSWORD_RESET_TOKEN_TTL_MINUTES, 30);
});

test("classifica token valido, invalido, expirado e usado sem depender de timezone local", () => {
  const now = new Date("2026-09-22T12:00:00.000Z");
  assert.equal(evaluatePasswordResetToken(null, now), "invalid");
  assert.equal(evaluatePasswordResetToken({ expiresAt: new Date("2026-09-22T12:00:01.000Z"), usedAt: null }, now), "valid");
  assert.equal(evaluatePasswordResetToken({ expiresAt: now, usedAt: null }, now), "expired");
  assert.equal(evaluatePasswordResetToken({ expiresAt: new Date("2026-09-22T13:00:00.000Z"), usedAt: now }, now), "used");
});

test("reutiliza a politica de senha no backend", () => {
  assert.equal(resetPasswordSchema.safeParse({ token: "a".repeat(43), password: "1234567", confirmPassword: "1234567" }).success, false);
  assert.equal(resetPasswordSchema.safeParse({ token: "a".repeat(43), password: "NovaSenha#2026", confirmPassword: "diferente" }).success, false);
  assert.equal(resetPasswordSchema.safeParse({ token: "a".repeat(43), password: "NovaSenha#2026", confirmPassword: "NovaSenha#2026" }).success, true);
});

test("monta link absoluto para a rota existente e escapa o token", () => {
  const previous = process.env.APP_URL;
  process.env.APP_URL = "https://alfa-homolog.example.test/";
  try {
    assert.equal(
      buildPasswordResetLink("token/com espaços"),
      "https://alfa-homolog.example.test/redefinir-senha?token=token%2Fcom%20espa%C3%A7os",
    );
  } finally {
    if (previous === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previous;
  }
});
