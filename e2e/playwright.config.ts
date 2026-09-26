import { defineConfig, devices } from "@playwright/test";

// Runs against the throwaway test stack started by scripts/test.sh.
export default defineConfig({
  // SCREENSHOTS=1 runs the README screenshot builder instead (scripts/screenshots.sh).
  testDir: process.env.SCREENSHOTS ? "docs" : "tests",
  globalSetup: process.env.SCREENSHOTS ? undefined : "./global-setup.ts",
  // One shared database: keep journeys sequential and predictable.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:28800",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Firefox: it decodes the AAC stream (Playwright's Chromium build can't).
  projects: [{ name: "firefox", use: { ...devices["Desktop Firefox"], launchOptions: { firefoxUserPrefs: { "media.autoplay.default": 0 } } } }],
});
