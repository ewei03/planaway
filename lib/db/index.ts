import path from "node:path";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

// Postgres when DATABASE_URL is set (Docker, Neon, RDS, ...). Otherwise
// PGlite: real Postgres compiled to WebAssembly, running in-process and
// persisting to data/pglite. Same schema and migrations either way.
// Migrations run once per process, on first use.

const MIGRATIONS = path.join(/*turbopackIgnore: true*/ process.cwd(), "drizzle");

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const db = drizzle(new Pool({ connectionString: url }), { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    return db;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  // "memory://" keeps the database in memory (used by tests).
  const dataDir = process.env.PGLITE_DIR ?? "data/pglite";
  const dir = dataDir.startsWith("memory://") ? dataDir : path.resolve(/*turbopackIgnore: true*/ dataDir);
  const db = drizzle(new PGlite(dir), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  // The two drivers expose the same query builder API.
  return db as unknown as Db;
}

// On globalThis so dev hot reloads and every route share one connection
// (PGlite allows only one per data directory).
const g = globalThis as typeof globalThis & { __planawayDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  g.__planawayDb ??= connect().catch((err) => {
    g.__planawayDb = undefined;
    throw err;
  });
  return g.__planawayDb;
}

export { schema };
