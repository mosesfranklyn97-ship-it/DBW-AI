import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

// Every serverless instance opens its own pool, so the per-instance ceiling
// stays at 1 and idle sockets are released quickly. Point connectionString at
// Supabase's Supavisor pooler, not the direct connection: Vercel has no IPv6
// and opens far more short-lived connections than a project can serve
// directly. Constructing a Pool never dials out, so a missing or blank
// DATABASE_URL surfaces on first query instead of failing the build.
export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL ?? "",
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: { rejectUnauthorized: false },
  });

globalForDb.__arenaNextJsPostgresqlPool = pool;

export const db = drizzle(pool);
