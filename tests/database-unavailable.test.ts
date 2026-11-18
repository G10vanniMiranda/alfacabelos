import assert from "node:assert/strict";
import test from "node:test";
import { isDatabaseUnavailableError, safeActionErrorMessage } from "../lib/errors";

// Observed while stopping PostgreSQL under load: the first failures are "Server has closed the
// connection", not "Can't reach database server"; both must surface as 503 / unavailable, never 400.
test("connection-level database failures are classified as unavailable", () => {
  for (const code of ["P1001", "P1002", "P1008", "P1017", "P2024"]) {
    assert.equal(isDatabaseUnavailableError({ code, message: "x" }), true, code);
  }
  assert.equal(isDatabaseUnavailableError({ message: "\nInvalid `prisma.service.findFirst()` invocation:\n\n\nServer has closed the connection." }), true);
  assert.equal(isDatabaseUnavailableError({ message: "Can't reach database server at `127.0.0.1:5432`" }), true);
  assert.equal(isDatabaseUnavailableError({ message: "Timed out fetching a new connection from the connection pool." }), true);
  assert.match(safeActionErrorMessage({ code: "P1017", message: "closed" }, "fallback"), /temporariamente indisponível/);
});

test("business and validation errors are not mistaken for an outage", () => {
  for (const error of [{ code: "P2002", message: "Unique constraint failed" }, { code: "P2034", message: "write conflict" },
    new Error("Conflito com agendamento existente"), null, "text", {}]) {
    assert.equal(isDatabaseUnavailableError(error), false, JSON.stringify(error));
  }
});
