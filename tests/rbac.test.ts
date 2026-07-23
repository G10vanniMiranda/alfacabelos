import assert from "node:assert/strict";
import test from "node:test";
import { scopeBarber } from "@/lib/auth/staff-auth";

test("ADMIN preserva escopo solicitado", () => {
  assert.equal(scopeBarber({ accessId: "a", email: "a@a.test", role: "ADMIN" }, "barber-2"), "barber-2");
});

test("BARBER sempre sobrescreve barberId recebido pelo próprio vínculo", () => {
  assert.equal(scopeBarber({ accessId: "b", email: "b@a.test", role: "BARBER", barberId: "barber-1" }, "barber-2"), "barber-1");
});

test("BARBER sem parâmetro continua limitado ao próprio vínculo", () => {
  assert.equal(scopeBarber({ accessId: "b", email: "b@a.test", role: "BARBER", barberId: "barber-1" }), "barber-1");
});
