import assert from "node:assert/strict";
import test from "node:test";
import { revokeAllAdminSessions } from "@/lib/auth/admin-session-revocation";

test("troca de senha revoga todas as sessões antigas do acesso e permite uma nova sessão", async () => {
  const sessions = new Map([
    ["token-atual", "admin-1"],
    ["token-outro-dispositivo", "admin-1"],
    ["token-outro-admin", "admin-2"],
  ]);

  const removed = await revokeAllAdminSessions({
    async deleteMany({ where }) {
      let count = 0;
      for (const [token, accessId] of sessions) {
        if (accessId === where.adminAccessId) {
          sessions.delete(token);
          count += 1;
        }
      }
      return { count };
    },
  }, "admin-1");

  assert.equal(removed, 2);
  assert.equal(sessions.has("token-atual"), false);
  assert.equal(sessions.has("token-outro-dispositivo"), false);
  assert.equal(sessions.has("token-outro-admin"), true);

  sessions.set("token-novo-login", "admin-1");
  assert.equal(sessions.has("token-novo-login"), true);
});
