import { defineConfig, devices } from "@playwright/test";

// PLAYWRIGHT_BASE_URL lets you point the tests at any host.
// Defaults to http://localhost:4321 (the local dev server).
// Set to e.g. https://www.antena.com.ar or a Pages preview URL
// (https://<hash>.antena.pages.dev) for "remote" runs.
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:4321";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Mobile-first design — the primary viewport the app is built for.
      // Most users will hit Antena from a phone.
      name: "mobile-chromium",
      use: { ...devices["Pixel 5"] },
    },
  ],
  // Auto-start the dev server only for local CI-like runs.
  // When PLAYWRIGHT_BASE_URL is overridden (e.g. for production
  // smoke tests or a Pages preview URL), the caller is responsible
  // for the server being up — don't try to spawn one.
  webServer: process.env.CI && !process.env.PLAYWRIGHT_BASE_URL ? {
    command: "pnpm dev",
    url: "http://localhost:4321",
    reuseExistingServer: false,
    timeout: 60_000,
  } : undefined,
});
