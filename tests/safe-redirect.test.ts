import assert from "node:assert/strict";
import test from "node:test";
import { getSafeInternalPath, getSafeStaffPath } from "@/lib/safe-redirect";

test("aceita apenas caminhos internos", () => {
  assert.equal(getSafeInternalPath("/agendar?barberId=1"), "/agendar?barberId=1");
  assert.equal(getSafeInternalPath("/cliente#historico"), "/cliente#historico");
});

test("bloqueia open redirect, protocolo e javascript URL", () => {
  for (const value of ["https://evil.example", "//evil.example", "javascript:alert(1)", "/\\evil.example"]) {
    assert.equal(getSafeInternalPath(value), "/cliente");
  }
});

test("limita retorno da equipe ao painel do papel autenticado", () => {
  assert.equal(getSafeStaffPath("/admin/agenda?date=2026-07-14", "ADMIN"), "/admin/agenda?date=2026-07-14");
  assert.equal(getSafeStaffPath("/barbeiro/agenda", "ADMIN"), "/admin/dashboard");
  assert.equal(getSafeStaffPath("/barbeiro/bloqueios", "BARBER"), "/barbeiro/bloqueios");
  assert.equal(getSafeStaffPath("/admin/dashboard", "BARBER"), "/barbeiro/agenda");
  assert.equal(getSafeStaffPath("https://evil.example", "ADMIN"), "/admin/dashboard");
});
