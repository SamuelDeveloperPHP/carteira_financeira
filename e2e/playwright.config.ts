import { defineConfig, devices } from "@playwright/test";

// Os testes usam o sistema JÁ no ar (docker compose up). Por padrão, o gateway
// local; em outro ambiente, defina BASE_URL.
export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1, // os testes criam contas e compartilham o mesmo limite de tentativas
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3080",
    locale: "pt-BR",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
