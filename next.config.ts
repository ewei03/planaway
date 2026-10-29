import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const root = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // End-to-end tests build into their own directory, so they can run while
  // `npm run dev` is up (Next allows one dev server per build directory).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The home folder above this project has its own package.json and lockfile;
  // pin the root so Next doesn't go looking there.
  outputFileTracingRoot: root,
  turbopack: { root },
  // Loaded from node_modules at runtime rather than bundled: PGlite ships
  // WebAssembly and data files that bundling breaks.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
};

export default nextConfig;
