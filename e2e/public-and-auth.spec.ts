import { expect, test } from "@playwright/test";

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const result = await page.evaluate(() => ({
    fits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll<HTMLElement>("body *")]
      .map((element) => ({ tag: element.tagName, className: element.className, right: element.getBoundingClientRect().right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }))
      .filter((item) => item.right > document.documentElement.clientWidth + 1 || item.scrollWidth > item.clientWidth + 1)
      .slice(0, 8),
  }));
  expect(result.fits, JSON.stringify(result, null, 2)).toBe(true);
}

test("home publica carrega navegacao principal sem overflow", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Alfa/i);
  await expect(page.locator('a[href="/agendar"]').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("fluxo publico de agendamento inicia e permanece responsivo", async ({ page }) => {
  await page.goto("/agendar");
  await expect(page.locator("main")).toBeVisible();
  await expect(page.getByText(/agend|servi/i).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("areas protegidas redirecionam visitantes", async ({ page }) => {
  await page.goto("/admin/dashboard");
  await expect(page).toHaveURL(/\/admin\?next=/);
  await page.goto("/barbeiro/agenda");
  await expect(page).toHaveURL(/\/admin\?next=/);
  await page.goto("/cliente");
  await expect(page).toHaveURL(/\/cliente\/login/);
});

test("login interno e recuperacao de cliente exibem formularios acessiveis", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByLabel(/e-mail/i)).toBeVisible();
  await expect(page.getByLabel("Senha", { exact: true })).toBeVisible();
  await page.goto("/esqueci-minha-senha");
  await expect(page.locator("form")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
