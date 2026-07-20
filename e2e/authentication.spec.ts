import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { createAdminAccess } from "@/lib/auth/admin-access-store";
import { createClient } from "@/lib/auth/client-store";
import { cancelBookingSeries, updateBookingSeriesOccurrences } from "@/lib/booking-series-service";

test.describe.configure({ mode: "serial" });

const runId = randomUUID().slice(0, 8);
const password = "TesteSeguro#2026";
const numericRunId = Number.parseInt(runId, 16).toString().padStart(9, "0").slice(-9);
const clientPhone = `69${numericRunId}`;
const pendingPhone = `68${numericRunId}`;
const invalidPhone = `67${numericRunId}`;
const recoveryPhone = `66${numericRunId}`;
const adminEmail = `qa-admin-${runId}@alfa.test`;
const barberEmail = `qa-barbeiro-${runId}@alfa.test`;
let clientId = "";
let pendingClientId = "";
let adminAccessId = "";
let barberAccessId = "";
let barberId = "";
let serviceId = "";
const recurrenceSeriesIds: string[] = [];

async function loginClient(page: Page, next = "/cliente") {
  await page.goto(`/cliente/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Telefone").fill(clientPhone);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}

async function loginStaff(page: Page, email: string) {
  await page.goto("/admin");
  await page.getByLabel("E-mail profissional").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}

test.beforeAll(async () => {
  const client = await createClient({ name: `Cliente QA ${runId}`, phone: clientPhone, password });
  clientId = client.id;
  const pending = await prisma.client.create({
    data: { name: `Cliente pendente ${runId}`, phone: pendingPhone, phoneNormalized: pendingPhone, hasPassword: false, status: "PENDING", createdBy: "BARBER" },
  });
  pendingClientId = pending.id;
  const admin = await createAdminAccess({ email: adminEmail, password, role: "ADMIN" });
  adminAccessId = admin.id;
  const barber = await prisma.barber.create({ data: { name: `Profissional QA ${runId}`, isActive: true } });
  barberId = barber.id;
  const service = await prisma.service.create({ data: { name: `Servico recorrente QA ${runId}`, durationMinutes: 30, priceCents: 3500 } });
  serviceId = service.id;
  const barberAccess = await createAdminAccess({ email: barberEmail, password, role: "BARBER", barberId });
  barberAccessId = barberAccess.id;
});

test.afterAll(async () => {
  if (recurrenceSeriesIds.length) {
    await prisma.booking.deleteMany({ where: { seriesId: { in: recurrenceSeriesIds } } });
    await prisma.bookingSeries.deleteMany({ where: { id: { in: recurrenceSeriesIds } } });
  }
  const accessIds = [adminAccessId, barberAccessId].filter(Boolean);
  if (accessIds.length) {
    await prisma.adminSession.deleteMany({ where: { adminAccessId: { in: accessIds } } });
    await prisma.adminAccess.deleteMany({ where: { id: { in: accessIds } } });
  }
  const clientIds = [clientId, pendingClientId].filter(Boolean);
  if (clientIds.length) await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  if (barberId) await prisma.barber.deleteMany({ where: { id: barberId } });
  if (serviceId) await prisma.service.deleteMany({ where: { id: serviceId } });
});

test("API autenticada materializa atomicamente todas as quartas-feiras da serie", async ({ page }) => {
  await loginClient(page);
  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() + ((3 - startDate.getUTCDay() + 7) % 7 || 7));
  const startsOn = startDate.toISOString().slice(0, 10);
  const endDate = new Date(`${startsOn}T12:00:00Z`);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  const repeatUntil = endDate.toISOString().slice(0, 10);
  const start = `${startsOn}T13:00:00.000Z`;
  const idempotencyKey = `e2e-${runId}-${test.info().project.name}`;
  const response = await page.evaluate(async (body) => {
    const result = await fetch("/api/booking", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: result.status, body: await result.json() };
  }, { serviceId, barberId, start, recurrence: "WEEKLY", repeatUntil, weekdays: [3], interval: 1, idempotencyKey });
  expect(response.status).toBe(201);
  expect(response.body.occurrenceCount).toBeGreaterThanOrEqual(4);
  recurrenceSeriesIds.push(response.body.seriesId);
  const persisted = await prisma.booking.findMany({ where: { seriesId: response.body.seriesId }, orderBy: { dateTimeStart: "asc" } });
  expect(persisted).toHaveLength(response.body.occurrenceCount);
  expect(new Set(persisted.map((item) => item.occurrenceLocalDate?.toISOString().slice(0, 10))).size).toBe(persisted.length);

  const duplicate = await page.evaluate(async (body) => {
    const result = await fetch("/api/booking", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: result.status, body: await result.json() };
  }, { serviceId, barberId, start, recurrence: "WEEKLY", repeatUntil, weekdays: [3], interval: 1, idempotencyKey });
  expect(duplicate.status).toBe(200);
  expect(duplicate.body.seriesId).toBe(response.body.seriesId);

  const conflictingKey = `${idempotencyKey}-conflict`;
  const conflict = await page.evaluate(async (body) => {
    const result = await fetch("/api/booking", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: result.status, body: await result.json() };
  }, { serviceId, barberId, start, recurrence: "WEEKLY", repeatUntil, weekdays: [3], interval: 1, idempotencyKey: conflictingKey });
  expect(conflict.status).toBe(409);
  expect(await prisma.bookingSeries.count({ where: { idempotencyKey: conflictingKey } })).toBe(0);

  await updateBookingSeriesOccurrences({
    bookingId: persisted[0]!.id, scope: "ALL", serviceId, barberId,
    customerName: `Cliente recorrente ${runId}`, customerPhone: clientPhone, start,
  });
  const renamed = await prisma.booking.findMany({ where: { seriesId: response.body.seriesId }, orderBy: { dateTimeStart: "asc" } });
  expect(renamed.every((item) => item.customerName === `Cliente recorrente ${runId}`)).toBe(true);
  const cancellation = await cancelBookingSeries({ bookingId: renamed[1]!.id, scope: "FUTURE", clientId });
  expect(cancellation.count).toBe(renamed.length - 1);
  expect((await prisma.booking.count({ where: { seriesId: response.body.seriesId, status: "CANCELADO" } }))).toBe(renamed.length - 1);
});

test("login do cliente mascara telefone, exibe senha e acessa a area correta", async ({ page }) => {
  await page.goto("/cliente/login");
  const phone = page.getByLabel("Telefone");
  await phone.pressSequentially(clientPhone);
  await expect(phone).toHaveValue(/\(69\) \d{5}-\d{4}/);
  const passwordInput = page.getByLabel("Senha", { exact: true });
  await passwordInput.fill(password);
  await expect(passwordInput).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Exibir senha" }).click();
  await expect(passwordInput).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Ocultar senha" }).click();
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/cliente$/);
  await expect(page.getByRole("heading", { name: /olá/i })).toBeVisible();
});

test("cliente recebe erros claros para telefone incompleto e credenciais invalidas", async ({ page }) => {
  await page.goto("/cliente/login");
  await page.getByLabel("Telefone").fill("69999");
  await page.getByLabel("Senha", { exact: true }).fill("qualquer");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.locator("#auth-feedback")).toContainText(/telefone inválido/i);

  await page.getByLabel("Telefone").fill(invalidPhone);
  await page.getByLabel("Senha", { exact: true }).fill("senha-incorreta");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.locator("#auth-feedback")).toContainText("Telefone ou senha incorretos.");
});

test("cliente sem senha recebe orientacao e CTA de primeira senha", async ({ page }) => {
  await page.goto("/cliente/login");
  await page.getByLabel("Telefone").fill(pendingPhone);
  await page.getByLabel("Senha", { exact: true }).fill("senha-temporaria");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.locator("#auth-feedback")).toContainText(/ainda precisa criar uma senha/i);
  await expect(page.getByRole("link", { name: "Criar minha primeira senha" })).toBeVisible();
});

test("loading bloqueia duplo envio", async ({ page }) => {
  await page.route("**/cliente/login**", async (route) => {
    if (route.request().method() === "POST") {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await route.continue();
  });
  await page.goto("/cliente/login");
  await page.getByLabel("Telefone").fill(invalidPhone);
  await page.getByLabel("Senha", { exact: true }).fill("senha-incorreta");
  const submit = page.getByRole("button", { name: "Entrar", exact: true });
  await submit.click();
  await expect(page.getByRole("button", { name: "Entrando..." })).toBeDisabled();
  await expect(page.locator("#auth-feedback")).toBeVisible();
});

test("sessao expirada e recuperacao de senha preservam privacidade", async ({ page }) => {
  await page.goto("/cliente/login?reason=session-expired");
  await expect(page.locator("#auth-feedback")).toContainText("Sua sessão expirou");
  await page.goto("/esqueci-minha-senha");
  await page.getByLabel("Telefone cadastrado").fill(recoveryPhone);
  await page.getByRole("button", { name: "Enviar instruções" }).click();
  await expect(page.getByRole("status")).toContainText(/se existir uma conta vinculada/i);
});

test("cliente autenticado nao retorna ao login e open redirect e bloqueado", async ({ page }) => {
  await loginClient(page, "https://evil.example");
  await expect(page).toHaveURL(/\/cliente$/);
  await page.goto("/cliente/login");
  await expect(page).toHaveURL(/\/cliente$/);
});

test("administrador entra e retorna somente para rota administrativa segura", async ({ page }) => {
  await loginStaff(page, adminEmail);
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await expect(page.getByRole("heading").first()).toBeVisible();
});

test("barbeiro entra no proprio painel e nao acessa painel administrativo", async ({ page }) => {
  await loginStaff(page, barberEmail);
  await expect(page).toHaveURL(/\/barbeiro\/agenda$/);
  await page.goto("/admin/dashboard");
  await expect(page).toHaveURL(/\/barbeiro\/agenda$/);
});

test("cliente nao acessa painel da equipe e logout exige novo login", async ({ page }) => {
  await loginClient(page);
  await expect(page).toHaveURL(/\/cliente$/);
  await page.goto("/admin/dashboard");
  await expect(page).toHaveURL(/\/admin(?:\?|$)/);
  await page.goto("/cliente");
  await page.getByRole("button", { name: "Sair da conta" }).click();
  await expect(page).toHaveURL(/\/cliente\/login/);
});

test("formularios mantem labels, autocomplete, teclado e responsividade", async ({ page }) => {
  for (const width of [320, 375, 390, 430, 768, 1440]) {
    await page.setViewportSize({ width, height: width >= 768 ? 900 : 720 });
    await page.goto("/cliente/login");
    await expect(page.getByLabel("Telefone")).toHaveAttribute("autocomplete", "tel");
    await expect(page.getByLabel("Senha", { exact: true })).toHaveAttribute("autocomplete", "current-password");
    const audit = await page.evaluate(() => ({
      fits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      duplicateIds: [...document.querySelectorAll("[id]")].map((item) => item.id).filter((id, index, ids) => ids.indexOf(id) !== index),
      unlabeledInputs: [...document.querySelectorAll("input:not([type=hidden])")].filter((input) => !input.getAttribute("aria-label") && !document.querySelector(`label[for="${input.id}"]`)).length,
    }));
    expect(audit, `auditoria em ${width}px`).toEqual({ fits: true, duplicateIds: [], unlabeledInputs: 0 });
  }
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
});
