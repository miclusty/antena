import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:4321",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // We don't auto-start the dev server here — CI runs start it manually
  // to keep this config self-contained for local dev as well.
  webServer: process.env.CI ? {
    command: "pnpm dev",
    url: "http://localhost:4321",
    reuseExistingServer: false,
    timeout: 60_000,
  } : undefined,
});
