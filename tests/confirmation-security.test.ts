import assert from "node:assert/strict";
import test from "node:test";
import { decideConfirmationTransition } from "@/lib/confirmation-security";

const now = new Date("2026-07-30T12:00:00.000Z");

test("confirma token válido e pendente", () => {
  assert.equal(
    decideConfirmationTransition({
      confirmationTokenExpiresAt: new Date("2026-07-30T13:00:00.000Z"),
      confirmationTokenUsedAt: null,
      status: "PENDENTE",
    }, now),
    "confirm",
  );
});

test("rejeita token inexistente, expirado ou ligado a estado incompatível", () => {
  assert.equal(decideConfirmationTransition(undefined, now), "reject");
  assert.equal(decideConfirmationTransition({
    confirmationTokenExpiresAt: new Date("2026-07-30T11:59:59.000Z"),
    confirmationTokenUsedAt: null,
    status: "PENDENTE",
  }, now), "reject");
  assert.equal(decideConfirmationTransition({
    confirmationTokenExpiresAt: new Date("2026-07-30T13:00:00.000Z"),
    confirmationTokenUsedAt: null,
    status: "CANCELADO",
  }, now), "reject");
});

test("retry do mesmo token confirmado é idempotente, mas token usado em outro estado é rejeitado", () => {
  assert.equal(decideConfirmationTransition({
    confirmationTokenExpiresAt: new Date("2026-07-30T11:00:00.000Z"),
    confirmationTokenUsedAt: new Date("2026-07-30T10:00:00.000Z"),
    status: "CONFIRMADO",
  }, now), "idempotent-success");
  assert.equal(decideConfirmationTransition({
    confirmationTokenExpiresAt: new Date("2026-07-30T13:00:00.000Z"),
    confirmationTokenUsedAt: new Date("2026-07-30T10:00:00.000Z"),
    status: "CANCELADO",
  }, now), "reject");
});
