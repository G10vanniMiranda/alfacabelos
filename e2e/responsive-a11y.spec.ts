import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { createAdminAccess } from "@/lib/auth/admin-access-store";

const WIDTHS = [320, 360, 375, 390, 430, 768, 1024, 1440];
const PUBLIC_PAGES = ["/", "/cliente/login", "/cliente/cadastro", "/esqueci-minha-senha", "/admin"];

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    // WebKit reports a route prefetch cancelled by the next navigation as an access-control error.
    if (/[?&]_rsc=.*access control checks/.test(error.message)) return;
    errors.push(`pageerror: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) errors.push(`http ${response.status()}: ${new URL(response.url()).pathname}`);
  });
  return errors;
}

async function auditPage(page: Page) {
  return page.evaluate(() => {
    // checkVisibility also excludes content of closed <details> (e.g. the collapsed mobile menu).
    const visible = (element: Element) => element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const nameOf = (element: Element) => {
      const labelled = element.getAttribute("aria-labelledby");
      const byId = labelled ? labelled.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ") : "";
      const labels = "labels" in element ? [...((element as HTMLInputElement).labels ?? [])].map((label) => label.textContent ?? "").join(" ") : "";
      return [element.getAttribute("aria-label"), byId, labels, element.getAttribute("title"), (element as HTMLElement).innerText, element.getAttribute("alt")]
        .filter(Boolean).join(" ").trim();
    };
    const fields = [...document.querySelectorAll("input:not([type=hidden]), select, textarea")].filter(visible);
    const controls = [...document.querySelectorAll("button, a[href], [role=button]")].filter(visible);
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      lang: document.documentElement.lang,
      unlabeledFields: fields.filter((field) => !nameOf(field)).map((field) => field.outerHTML.slice(0, 120)),
      unnamedControls: controls.filter((control) => !nameOf(control) && !control.querySelector("img[alt]:not([alt=''])"))
        .map((control) => control.outerHTML.slice(0, 120)),
      imagesWithoutAlt: [...document.querySelectorAll("img:not([alt])")].filter(visible).length,
    };
  });
}

for (const path of PUBLIC_PAGES) {
  test(`${path} sem overflow, com nomes acessíveis e sem erros em ${WIDTHS.length} larguras`, async ({ page }) => {
    const errors = collectErrors(page);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const audit = await auditPage(page);
      expect(audit.overflow, `${path} @${width}px`).toBeLessThanOrEqual(1);
      expect(audit.lang, path).toBe("pt-BR");
      expect(audit.unlabeledFields, `${path} @${width}px`).toEqual([]);
      expect(audit.unnamedControls, `${path} @${width}px`).toEqual([]);
      expect(audit.imagesWithoutAlt, `${path} @${width}px`).toBe(0);
    }
    expect(errors).toEqual([]);
  });
}

test("redução de movimento e foco visível pelo teclado no login", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/cliente/login");
  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) return null;
    const style = getComputedStyle(element);
    return { tag: element.tagName, outline: style.outlineStyle !== "none" && style.outlineWidth !== "0px", ring: style.boxShadow !== "none" };
  });
  expect(focus, "Tab deve focar um elemento").not.toBeNull();
  expect(focus!.outline || focus!.ring, JSON.stringify(focus)).toBe(true);
});

test.describe("painel administrativo", () => {
  test.describe.configure({ mode: "serial" });
  const runId = randomUUID().slice(0, 8);
  const email = `qa-ux-${runId}@alfa.test`;
  const password = "TesteSeguro#2026";
  let accessId = "";

  test.beforeAll(async () => {
    accessId = (await createAdminAccess({ email, password, role: "ADMIN" })).id;
  });
  test.afterAll(async () => {
    if (!accessId) return;
    await prisma.adminSession.deleteMany({ where: { adminAccessId: accessId } });
    await prisma.adminAccess.deleteMany({ where: { id: accessId } });
  });

  test("avisos de agendamento acessíveis e painel sem overflow em 320 e 1440 px", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/admin");
    await page.getByLabel("E-mail profissional").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard$/);
    const alerts = page.getByRole("region", { name: /Avisos de agendamento/ });
    await expect(alerts).toBeVisible();
    const toggle = alerts.getByRole("button", { name: "Ver avisos" });
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(alerts.getByRole("button", { name: "Ocultar" })).toHaveAttribute("aria-expanded", "true");
    await expect(alerts.locator("#admin-alerts-list")).toBeVisible();
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const audit = await auditPage(page);
      expect(audit.overflow, `dashboard @${width}px`).toBeLessThanOrEqual(1);
      expect(audit.unnamedControls, `dashboard @${width}px`).toEqual([]);
    }
    expect(errors).toEqual([]);
  });
});
