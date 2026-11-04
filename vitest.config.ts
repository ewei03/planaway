import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

// Two projects: server code (lib/, app/api/) runs in Node against an in-memory
// PGlite database; React components run in jsdom. Playwright's end-to-end
// tests live in e2e/ and are run separately with `npm run test:e2e`.
export default defineConfig({
  resolve: { alias: { "@": root } },
  esbuild: { jsx: "automatic" },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "server",
          environment: "node",
          include: ["tests/server/**/*.test.ts"],
          setupFiles: ["tests/setup/server.ts"],
          // bcrypt at cost 12 and PGlite migrations are slow-ish.
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: "ui",
          environment: "jsdom",
          include: ["tests/ui/**/*.test.tsx"],
          setupFiles: ["tests/setup/ui.ts"],
          // Typing into forms takes a second or so alone, and several times that while the server tests run alongside.
          testTimeout: 15_000,
        },
      },
    ],
    coverage: {
      include: ["lib/**", "app/**", "components/**"],
    },
  },
});
