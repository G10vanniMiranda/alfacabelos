import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { prismaRepository } from "@/lib/repositories/prisma";
import { authenticateClient, createClient, createClientSession, findClientBySessionToken, revokeClientSession } from "@/lib/auth/client-store";
import { createPasswordResetForIdentifier, resetClientPasswordWithToken } from "@/lib/auth/client-password-reset-store";
import { authenticateAdminAccess, createAdminAccess, deleteAdminAccess } from "@/lib/auth/admin-access-store";
import { createAdminSession, getAdminSessionPrincipal, isAdminSessionTokenValid, revokeAdminSession } from "@/lib/auth/admin-session-store";
import { cancelClientBooking, rescheduleClientBooking } from "@/lib/booking-service";
import { zonedDateTimeToUtcIso } from "@/lib/utils";
import { dispatchWhatsAppNotification } from "@/lib/notifications/service";

type Check = { name: string; status: "PASS" | "WARN" | "FAIL"; detail: string };
const checks: Check[] = [];
const writeTests = process.argv.includes("--write-tests");

function record(name: string, status: Check["status"], detail: string) {
  checks.push({ name, status, detail });
}

function configurationCheck(name: string, required: boolean) {
  const configured = Boolean(process.env[name]?.trim());
  record(`env:${name}`, configured ? "PASS" : required ? "FAIL" : "WARN", configured ? "configurada" : "ausente");
}

async function validateDatabase() {
  const connection = await prisma.$queryRaw<Array<{ database: string; timezone: string; now: Date }>>`
    SELECT current_database() AS "database", current_setting('TimeZone') AS "timezone", now() AS "now"
  `;
  assert.ok(connection[0]?.database);
  record("database:connection", "PASS", `conectado; timezone do PostgreSQL=${connection[0]?.timezone ?? "desconhecido"}`);

  const expectedTables = [
    "AdminAccess", "AdminLoginAttempt", "AdminSession", "Barber", "BarberAvailability", "BlockedSlot",
    "Booking", "BookingSeries", "Client", "ClientSession", "GalleryImage", "NotificationDelivery", "PasswordResetToken", "SecurityRateLimitEvent", "Service",
  ];
  const tables = await prisma.$queryRaw<Array<{ tableName: string }>>`
    SELECT table_name AS "tableName"
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `;
  const present = new Set(tables.map((item) => item.tableName));
  const missing = expectedTables.filter((name) => !present.has(name));
  record("database:tables", missing.length ? "FAIL" : "PASS", missing.length ? `ausentes: ${missing.join(", ")}` : `${expectedTables.length} tabelas esperadas presentes`);

  const requiredColumns = await prisma.$queryRaw<Array<{ tableName: string; columnName: string }>>`
    SELECT table_name AS "tableName", column_name AS "columnName"
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'Service' AND column_name = 'isProcedure')
        OR
        (table_name = 'Booking' AND column_name IN ('seriesId', 'occurrenceIndex', 'occurrenceLocalDate'))
      )
  `;
  const presentColumns = new Set(requiredColumns.map((item) => `${item.tableName}.${item.columnName}`));
  const expectedColumns = [
    "Service.isProcedure",
    "Booking.seriesId",
    "Booking.occurrenceIndex",
    "Booking.occurrenceLocalDate",
  ];
  const missingColumns = expectedColumns.filter((column) => !presentColumns.has(column));
  record(
    "database:columns",
    missingColumns.length ? "FAIL" : "PASS",
    missingColumns.length ? `ausentes: ${missingColumns.join(", ")}` : "colunas evolutivas presentes",
  );

  const rls = await prisma.$queryRaw<Array<{ tableName: string; enabled: boolean }>>`
    SELECT c.relname AS "tableName", c.relrowsecurity AS "enabled"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY(${expectedTables})
    ORDER BY c.relname
  `;
  const enabled = rls.filter((item) => item.enabled).map((item) => item.tableName);
  const rlsMissing = expectedTables.filter((name) => !enabled.includes(name));
  record("database:rls", rlsMissing.length ? "FAIL" : "PASS", rlsMissing.length ? `RLS ausente em: ${rlsMissing.join(", ")}` : `RLS ativo nas ${expectedTables.length} tabelas publicas da aplicacao`);

  const policies = await prisma.$queryRaw<Array<{ schemaName: string; tableName: string; policyName: string; command: string; roles: string[]; usingExpression: string | null; checkExpression: string | null }>>`
    SELECT schemaname AS "schemaName", tablename AS "tableName", policyname AS "policyName", cmd AS "command", roles,
           qual AS "usingExpression", with_check AS "checkExpression"
    FROM pg_policies
    WHERE schemaname IN ('public', 'storage')
  `;
  const publicPolicies = policies.filter((item) => item.schemaName === "public");
  const storagePolicies = policies.filter((item) => item.schemaName === "storage" && item.tableName === "objects");
  const publicMutationPolicies = publicPolicies.filter((item) => item.command !== "SELECT");
  record(
    "database:rls-mutations",
    publicMutationPolicies.length ? "WARN" : "PASS",
    publicMutationPolicies.length
      ? publicMutationPolicies.map((item) => `${item.tableName}:${item.command}:${item.roles.join("|")}:using=${item.usingExpression}:check=${item.checkExpression}`).join(", ")
      : "nenhuma política pública de mutação",
  );
  record("database:rls-policies", "PASS", `${publicPolicies.length} política(s) públicas explícitas; acesso sem política permanece negado`);
  record("supabase:storage-policies", storagePolicies.length ? "PASS" : "WARN", `${storagePolicies.length} política(s) em storage.objects; uploads da aplicação usam service role no servidor`);

  const [services, barbers, bookings, clients, admins] = await Promise.all([
    prisma.service.count({ where: { isActive: true } }),
    prisma.barber.count({ where: { isActive: true } }),
    prisma.booking.count(),
    prisma.client.count(),
    prisma.adminAccess.count({ where: { isActive: true } }),
  ]);
  record("database:real-data", services > 0 && barbers > 0 ? "PASS" : "FAIL", `serviços=${services}; profissionais=${barbers}; agendamentos=${bookings}; clientes=${clients}; admins=${admins}`);

  const invalidDurations = await prisma.service.count({ where: { OR: [{ durationMinutes: { lt: 15 } }, { durationMinutes: { gt: 240 } }] } });
  record("database:service-durations", invalidDurations === 0 ? "PASS" : "FAIL", invalidDurations ? `${invalidDurations} duração(ões) fora de 15–240 min` : "todas as durações dentro dos limites");
  if (presentColumns.has("Service.isProcedure")) {
    const invalidStandardDurations = await prisma.service.count({
      where: { isProcedure: false, durationMinutes: { gt: 50 } },
    });
    record(
      "database:standard-service-duration",
      invalidStandardDurations === 0 ? "PASS" : "FAIL",
      invalidStandardDurations
        ? `${invalidStandardDurations} serviço(s) comum(ns) acima de 50 min`
        : "serviços comuns respeitam o bloco de uma hora",
    );
  }
}

async function validateStorage() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET;
  if (!url || !key || !bucket) {
    record("supabase:storage", "FAIL", "URL, service role key ou bucket ausente");
    return;
  }
  try {
    const response = await fetch(`${url}/storage/v1/bucket/${encodeURIComponent(bucket)}`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    record("supabase:storage", response.ok ? "PASS" : "FAIL", response.ok ? "bucket acessível pela API administrativa" : `API respondeu HTTP ${response.status}`);
  } catch (error) {
    record("supabase:storage", "FAIL", error instanceof Error ? error.name : "falha de rede");
  }
}

async function validateAuthentication(runId: string) {
  const phoneDigits = `69${String(Date.now()).slice(-9)}`;
  const phone = `(${phoneDigits.slice(0, 2)}) ${phoneDigits.slice(2, 7)}-${phoneDigits.slice(7)}`;
  const pending = await prisma.client.create({
    data: { name: `Homologação ${runId}`, phone, phoneNormalized: phoneDigits, hasPassword: false, status: "PENDING", createdBy: "BARBER" },
  });
  try {
    const activated = await createClient({ name: pending.name, phone, password: "TesteSeguro#2026" });
    assert.equal(activated.id, pending.id);
    assert.equal((await authenticateClient(phone, "senha-incorreta")), null);
    assert.equal((await authenticateClient(phone, "TesteSeguro#2026"))?.id, pending.id);

    const session = await createClientSession(pending.id);
    assert.equal((await findClientBySessionToken(session.token))?.id, pending.id);
    await prisma.clientSession.updateMany({ where: { clientId: pending.id }, data: { expiresAt: new Date(0) } });
    assert.equal(await findClientBySessionToken(session.token), undefined);
    const revocableSession = await createClientSession(pending.id);
    await revokeClientSession(revocableSession.token);
    assert.equal(await findClientBySessionToken(revocableSession.token), undefined);

    const reset = await createPasswordResetForIdentifier(phone);
    assert.ok(reset?.resetLink);
    const token = new URL(reset.resetLink).searchParams.get("token");
    assert.ok(token);
    assert.equal(await resetClientPasswordWithToken(token, "NovaSenha#2026"), true);
    assert.equal((await authenticateClient(phone, "NovaSenha#2026"))?.id, pending.id);
    record("auth:client", "PASS", "primeira senha, login, erro de login, sessão, logout e recuperação validados no banco real");
  } finally {
    await prisma.client.deleteMany({ where: { id: pending.id } });
  }
}

async function validateAdminAuthentication(runId: string) {
  const email = `qa-${runId}@example.invalid`;
  const access = await createAdminAccess({ email, password: "AdminTeste#2026" });
  try {
    assert.equal(await authenticateAdminAccess(email, "incorreta"), null);
    assert.equal((await authenticateAdminAccess(email, "AdminTeste#2026"))?.id, access.id);
    assert.equal((await authenticateAdminAccess(email, "AdminTeste#2026"))?.role, "ADMIN");
    const session = await createAdminSession({ email, adminAccessId: access.id });
    assert.equal(await isAdminSessionTokenValid(session.token), true);
    assert.equal((await getAdminSessionPrincipal(session.token))?.role, "ADMIN");
    await revokeAdminSession(session.token);
    assert.equal(await isAdminSessionTokenValid(session.token), false);
    record("auth:admin", "PASS", "login inválido/válido, sessão persistida e logout validados no banco real");
  } finally {
    await deleteAdminAccess(access.id);
  }
}

async function validateBarberAuthentication(runId: string) {
  const barber = await prisma.barber.create({ data: { name: `QA RBAC ${runId}` } });
  const email = `qa-barber-${runId}@example.invalid`;
  const access = await createAdminAccess({ email, password: "BarberTeste#2026", role: "BARBER", barberId: barber.id });
  try {
    const session = await createAdminSession({ email, adminAccessId: access.id });
    const principal = await getAdminSessionPrincipal(session.token);
    assert.equal(principal?.role, "BARBER");
    assert.equal(principal?.barberId, barber.id);
    await revokeAdminSession(session.token);
    record("auth:barber-rbac", "PASS", "sessão BARBER preserva papel e vínculo exclusivo ao profissional");
  } finally {
    await deleteAdminAccess(access.id);
    await prisma.barber.delete({ where: { id: barber.id } });
  }
}

async function validateNotificationOutbox(runId: string) {
  const key = `qa:${runId}:not-configured`;
  try {
    const first = await dispatchWhatsAppNotification({ event: "PASSWORD_RESET", to: "(69) 99999-9999", message: "QA", context: "qa", idempotencyKey: key });
    const second = await dispatchWhatsAppNotification({ event: "PASSWORD_RESET", to: "(69) 99999-9999", message: "QA", context: "qa", idempotencyKey: key });
    assert.equal(first.status, "not_configured");
    assert.equal(second.deliveryId, first.deliveryId);
    assert.equal(await prisma.notificationDelivery.count({ where: { idempotencyKey: key } }), 1);
    record("whatsapp:outbox", "PASS", "sem credenciais retorna not_configured e idempotência impede duplicidade");
  } finally {
    await prisma.notificationDelivery.deleteMany({ where: { idempotencyKey: key } });
  }
}

async function validateConcurrencyAndReschedule(runId: string) {
  const barber = await prisma.barber.create({ data: { name: `QA Barber ${runId}`, isActive: true } });
  const service = await prisma.service.create({ data: { name: `QA Service ${runId}`, durationMinutes: 45, priceCents: 100, isActive: true } });
  const start = zonedDateTimeToUtcIso("2037-07-14", "09:00:00", "America/Porto_Velho");
  const end = zonedDateTimeToUtcIso("2037-07-14", "09:55:00", "America/Porto_Velho");
  try {
    const createInput = (customerName: string) => ({
      barberId: barber.id,
      serviceId: service.id,
      customerName,
      customerPhone: "(69) 99999-9999",
      dateTimeStart: start,
      dateTimeEnd: end,
      createdBy: "CLIENT" as const,
    });
    const results = await Promise.allSettled([
      prismaRepository.createBooking(createInput("Concorrente A")),
      prismaRepository.createBooking(createInput("Concorrente B")),
    ]);
    const fulfilled = results.filter((item) => item.status === "fulfilled");
    const rejected = results.filter((item) => item.status === "rejected");
    const persisted = await prisma.booking.count({ where: { barberId: barber.id, status: { not: "CANCELADO" }, dateTimeStart: { lt: new Date(end) }, dateTimeEnd: { gt: new Date(start) } } });
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(persisted, 1);
    record("booking:concurrency", "PASS", "2 gravações simultâneas: 1 persistida, 1 rejeitada, 0 sobreposição duplicada");

    await prisma.booking.deleteMany({ where: { barberId: barber.id } });
    const phoneDigits = `68${String(Date.now()).slice(-9)}`;
    const client = await prisma.client.create({ data: { name: `QA Cliente ${runId}`, phone: phoneDigits, phoneNormalized: phoneDigits, hasPassword: false, status: "PENDING", createdBy: "BARBER" } });
    try {
      const original = await prismaRepository.createBooking({ ...createInput(client.name), clientId: client.id, customerPhone: phoneDigits });
      const newStart = zonedDateTimeToUtcIso("2037-07-14", "10:00:00", "America/Porto_Velho");
      await rescheduleClientBooking({ bookingId: original.id, clientId: client.id, serviceId: service.id, barberId: barber.id, start: newStart });
      const rows = await prisma.booking.findMany({ where: { id: original.id } });
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.dateTimeStart.toISOString(), newStart);
      record("booking:reschedule", "PASS", "mesmo registro atualizado atomicamente; horário antigo liberado após sucesso");

      await assert.rejects(
        cancelClientBooking({ bookingId: original.id, customerPhone: "(69) 90000-0000" }),
        /permissão/,
      );
      await cancelClientBooking({ bookingId: original.id, customerPhone: phoneDigits });
      await cancelClientBooking({ bookingId: original.id, customerPhone: phoneDigits });
      assert.equal((await prisma.booking.findUnique({ where: { id: original.id } }))?.status, "CANCELADO");
      const replacement = await prismaRepository.createBooking({
        ...createInput("Horário liberado"),
        dateTimeStart: newStart,
        dateTimeEnd: zonedDateTimeToUtcIso("2037-07-14", "10:55:00", "America/Porto_Velho"),
      });
      assert.ok(replacement.id);
      record("booking:cancel", "PASS", "posse validada, duplo cancelamento idempotente, histórico preservado e horário liberado");

      const past = await prismaRepository.createBooking({
        ...createInput("Atendimento passado"),
        dateTimeStart: "2020-01-02T13:00:00.000Z",
        dateTimeEnd: "2020-01-02T13:55:00.000Z",
        customerPhone: phoneDigits,
        clientId: client.id,
      });
      await assert.rejects(cancelClientBooking({ bookingId: past.id, customerPhone: phoneDigits }), /já aconteceu/);
      record("booking:past-cancel", "PASS", "cancelamento de atendimento passado recusado no servidor");
    } finally {
      await prisma.client.deleteMany({ where: { id: client.id } });
    }
  } finally {
    await prisma.booking.deleteMany({ where: { barberId: barber.id } });
    await prisma.service.deleteMany({ where: { id: service.id } });
    await prisma.barber.deleteMany({ where: { id: barber.id } });
  }
}

async function validateFixtureCleanup() {
  const [barbers, services, clients, admins] = await Promise.all([
    prisma.barber.count({ where: { name: { startsWith: "QA Barber" } } }),
    prisma.service.count({ where: { name: { startsWith: "QA Service" } } }),
    prisma.client.count({ where: { OR: [{ name: { startsWith: "QA Cliente" } }, { name: { startsWith: "Homologação" } }] } }),
    prisma.adminAccess.count({ where: { email: { startsWith: "qa-" } } }),
  ]);
  const total = barbers + services + clients + admins;
  record("integration:fixture-cleanup", total === 0 ? "PASS" : "FAIL", total === 0 ? "nenhuma fixture temporária remanescente" : `${total} fixture(s) remanescente(s)`);
}

async function main() {
  configurationCheck("DATABASE_URL", true);
  configurationCheck("DIRECT_URL", true);
  configurationCheck("APP_URL", false);
  configurationCheck("NEXT_PUBLIC_APP_URL", false);
  configurationCheck("SUPABASE_URL", true);
  configurationCheck("SUPABASE_SERVICE_ROLE_KEY", true);
  configurationCheck("SUPABASE_STORAGE_BUCKET", true);
  configurationCheck("WHATSAPP_ENABLED", false);
  configurationCheck("WHATSAPP_API_URL", false);
  configurationCheck("WHATSAPP_API_TOKEN", false);
  configurationCheck("WHATSAPP_OWNER_PHONE", false);

  await validateDatabase();
  await validateStorage();
  if (writeTests) {
    const runId = randomUUID().slice(0, 8);
    await validateAuthentication(runId);
    await validateAdminAuthentication(runId);
    await validateBarberAuthentication(runId);
    await validateNotificationOutbox(runId);
    await validateConcurrencyAndReschedule(runId);
    await validateFixtureCleanup();
  } else {
    record("integration:write-tests", "WARN", "não executados; use npm run test:integration para fixtures temporárias");
  }

  for (const check of checks) {
    console.log(`${check.status.padEnd(4)} ${check.name} — ${check.detail}`);
  }
  const failures = checks.filter((item) => item.status === "FAIL");
  if (failures.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("FAIL validation —", error instanceof Error ? error.message : "erro inesperado");
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
