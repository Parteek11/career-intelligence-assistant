import { Pool } from "pg";

/**
 * Shared PostgreSQL connection pool.
 *
 * Next.js hot-reloads API routes in development, which would otherwise
 * create a new `Pool` (and leak connections) on every file save. Storing
 * the pool on `globalThis` survives those reloads. `max: 10` is enough
 * for this single-user MVP (upload, analyze, and eval share the same DB).
 */
const globalForPg = globalThis as unknown as { pgPool?: Pool };

/** Return the process-wide pool. Throws if `DATABASE_URL` is missing. */
export function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  if (!globalForPg.pgPool) {
    globalForPg.pgPool = new Pool({ connectionString, max: 10 });
  }

  return globalForPg.pgPool;
}
