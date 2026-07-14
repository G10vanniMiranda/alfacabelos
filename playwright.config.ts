import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const testPort = new URL(baseURL).port || "3000";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npm run dev -- --port ${testPort}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit-iphone", use: { ...devices["iPhone 13"] } },
    { name: "chromium-android", use: { ...devices["Pixel 7"] } },
    { name: "chromium-tablet", use: { ...devices["iPad (gen 7)"], browserName: "chromium" } },
  ],
});
