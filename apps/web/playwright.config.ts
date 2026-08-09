import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3100";
const authURL = "http://127.0.0.1:54331";
const apiURL = "http://127.0.0.1:8788";

export default defineConfig({
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  outputDir: "../../output/playwright/results",
  reporter: process.env.CI ? "github" : "list",
  retries: process.env.CI ? 1 : 0,
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node test/fixtures/supabase-auth.mjs",
      env: { AUTH_FIXTURE_PORT: "54331" },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      url: `${authURL}/auth/v1/.well-known/jwks.json`,
    },
    {
      command: "node_modules/.bin/next dev --hostname 0.0.0.0 --port 3100",
      env: {
        NEXT_PUBLIC_API_BASE_URL: apiURL,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "roavia-browser-fixture",
        NEXT_PUBLIC_SUPABASE_URL: authURL,
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: baseURL,
    },
  ],
  workers: 1,
});
