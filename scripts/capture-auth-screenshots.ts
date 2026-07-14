import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const baseURL = (process.env.TEST_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const outputDir = path.join(process.cwd(), "artifacts", "auth");

async function capture() {
  await mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch();

  for (const screen of [
    { name: "cliente-login-desktop", route: "/cliente/login", viewport: { width: 1440, height: 1000 } },
    { name: "equipe-login-desktop", route: "/admin", viewport: { width: 1440, height: 1000 } },
    { name: "cliente-login-mobile", route: "/cliente/login", viewport: { width: 390, height: 844 } },
    { name: "equipe-login-mobile", route: "/admin", viewport: { width: 390, height: 844 } },
  ]) {
    const page = await browser.newPage({ viewport: screen.viewport, deviceScaleFactor: 1 });
    await page.goto(`${baseURL}${screen.route}`, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(outputDir, `${screen.name}.png`), fullPage: true });
    await page.close();
  }

  await browser.close();
}

capture().catch((error) => {
  console.error(error instanceof Error ? error.message : "Falha ao gerar capturas");
  process.exitCode = 1;
});
