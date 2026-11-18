import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { createAdminAccess } from "@/lib/auth/admin-access-store";

// Full journey through the UI: a new client registers, books with the wizard, cancels from the
// client area, and the owner sees both changes as persistent alerts in the admin panel.
test.describe.configure({ mode: "serial" });
// Registration is rate-limited per client IP (a security control). Each run of this journey (one per
// browser project) presents its own synthetic address, as the proxy would for distinct visitors.
test.use({ extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250) + 1}` } });

const runId = randomUUID().slice(0, 8);
const password = "TesteSeguro#2026";
const clientName = `Cliente Jornada ${runId}`;
// Synthetic number: DDD 20 is not assigned in Brazil.
const clientPhone = `209${Number.parseInt(runId, 16).toString().padStart(8, "0").slice(-8)}`;
const adminEmail = `qa-jornada-${runId}@alfa.test`;
let adminAccessId = "";

test.afterAll(async () => {
  const client = await prisma.client.findFirst({ where: { phoneNormalized: { endsWith: clientPhone.slice(-9) } }, select: { id: true } });
  const bookings = await prisma.booking.findMany({ where: { customerName: clientName }, select: { id: true } });
  await prisma.notificationDelivery.deleteMany({ where: { bookingId: { in: bookings.map((b) => b.id) } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookings.map((b) => b.id) } } });
  if (client) await prisma.client.deleteMany({ where: { id: client.id } });
  if (adminAccessId) {
    await prisma.adminSession.deleteMany({ where: { adminAccessId } });
    await prisma.adminAccess.deleteMany({ where: { id: adminAccessId } });
  }
});

async function continueWizard(page: Page) {
  await page.getByRole("button", { name: /^(Continuar|Ver agenda disponível)$/ }).first().click();
}

test("cliente se cadastra, agenda pelo assistente e cancela pela área do cliente", async ({ page }) => {
  await page.goto("/cliente/cadastro?next=/agendar");
  await page.getByLabel("Nome completo").fill(clientName);
  await page.getByLabel("Telefone").fill(clientPhone);
  await page.getByLabel("Crie uma senha", { exact: true }).fill(password);
  await page.getByLabel("Confirme sua senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Criar minha conta" }).click();
  await expect(page).toHaveURL(/\/agendar/, { timeout: 20_000 });

  // Step 1: service; step 2: professional.
  await page.getByRole("button", { name: /minutos/ }).first().click();
  await continueWizard(page);
  await page.locator("button[aria-pressed]").first().click();
  await continueWizard(page);

  // Step 3: a date next month (always inside the booking window) and the first free slot.
  await page.getByRole("button", { name: "Próximo mês" }).click();
  const days = page.locator("button[aria-pressed]:not([disabled])");
  await expect(days.first()).toBeVisible();
  const slots = page.locator("button[aria-pressed]").filter({ hasText: /^\s*\d{1,2}[:h]\d{2}\s*$/ });
  let booked = false;
  for (let i = 0; i < Math.min(await days.count(), 10) && !booked; i += 1) {
    await days.nth(i).click();
    await slots.first().waitFor({ timeout: 5_000 }).catch(() => undefined);
    if (await slots.count()) {
      await slots.first().click();
      booked = true;
    }
  }
  expect(booked, "a free slot must exist next month").toBe(true);
  await continueWizard(page);

  // Step 4: review shows the client's data and confirms.
  await expect(page.getByLabel("Nome completo")).toHaveValue(clientName);
  await page.getByRole("button", { name: "Confirmar agendamento" }).click();
  await expect(page).not.toHaveURL(/\/agendar$/, { timeout: 20_000 });
  await expect.poll(() => prisma.booking.count({ where: { customerName: clientName, status: { not: "CANCELADO" } } })).toBe(1);

  // Client area lists it and cancels it.
  await page.goto("/cliente");
  await expect(page.getByText(/Próximo|Agendado|Pendente|Confirmado/i).first()).toBeVisible();
  await page.getByRole("button", { name: "Cancelar", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Cancelar este horário?" })).toBeVisible();
  await page.getByRole("button", { name: "Somente este" }).click();
  await expect.poll(() => prisma.booking.count({ where: { customerName: clientName, status: "CANCELADO" } }), { timeout: 15_000 }).toBe(1);
});

test("o dono vê criação e cancelamento como avisos, marca como vistos e o estado persiste após recarregar", async ({ page }) => {
  adminAccessId = (await createAdminAccess({ email: adminEmail, password, role: "ADMIN" })).id;
  await page.goto("/admin");
  await page.getByLabel("E-mail profissional").fill(adminEmail);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);

  const alerts = page.getByRole("region", { name: /Avisos de agendamento/ });
  await expect(alerts.getByText(/novos?$/)).toBeVisible();
  await alerts.getByRole("button", { name: "Ver avisos" }).click();
  const list = alerts.locator("#admin-alerts-list");
  await expect(list.getByText(clientName).first()).toBeVisible();
  await expect(list.getByText("Novo agendamento (cliente)").first()).toBeVisible();
  await expect(list.getByText("Cancelamento").first()).toBeVisible();

  await alerts.getByRole("button", { name: "Marcar como vistos" }).click();
  await expect(alerts.getByText(/novos?$/)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("region", { name: /Avisos de agendamento/ }).getByText(/novos?$/)).toHaveCount(0);
});
