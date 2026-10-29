import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const MOCK_PORT = 3101;

// End-to-end tests run the real app (next dev) against an in-memory database
// and a mock Anthropic API, so they need no API key and never touch
// data/pglite. The server builds into .next-e2e, so it can run alongside your
// own `npm run dev`.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // One worker: the dev server compiles routes on first hit, and all tests
  // share one server process.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    permissions: ["clipboard-read", "clipboard-write"],
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: [
    {
      command: "node e2e/mock-anthropic.mjs",
      url: `http://localhost:${MOCK_PORT}/health`,
      env: { MOCK_ANTHROPIC_PORT: String(MOCK_PORT) },
      reuseExistingServer: false,
    },
    {
      command: `npx next dev --port ${PORT}`,
      url: `http://localhost:${PORT}/login`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        NEXT_DIST_DIR: ".next-e2e",
        PGLITE_DIR: "memory://",
        DATABASE_URL: "",
        ANTHROPIC_BASE_URL: `http://localhost:${MOCK_PORT}`,
        ANTHROPIC_API_KEY: "test-key",
        // Place lookups, photos, and the map style come from the mock server
        // too, so tests never hit OpenStreetMap or Wikimedia.
        NOMINATIM_URL: `http://localhost:${MOCK_PORT}`,
        NOMINATIM_INTERVAL_MS: "0",
        WIKIDATA_URL: `http://localhost:${MOCK_PORT}`,
        COMMONS_URL: `http://localhost:${MOCK_PORT}`,
        MAP_STYLE_URL: `http://localhost:${MOCK_PORT}/style.json`,
        AUTH_SECRET: "e2e-test-secret-not-for-production-use",
      },
    },
  ],
});
