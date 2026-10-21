import assert from "node:assert/strict";
import test from "node:test";
import { isBookingConflictError } from "../lib/booking-service";

test("classifica disputa serializável da agenda como conflito HTTP", () => {
  assert.equal(isBookingConflictError(new Error("A agenda mudou durante a reserva. Tente novamente.")), true);
  assert.equal(isBookingConflictError(new Error("Conflito com agendamento existente")), true);
  assert.equal(isBookingConflictError(new Error("Falha interna inesperada")), false);
});
