// Every server test file gets its own empty in-memory Postgres. The real
// data/pglite directory and any DATABASE_URL in .env are never touched.
delete process.env.DATABASE_URL;
process.env.PGLITE_DIR = "memory://";
(globalThis as { __planawayDb?: unknown }).__planawayDb = undefined;
