import "server-only";

import { Pool } from "pg";
import { getDatabaseUrl } from "@/lib/config";

const globalForPg = globalThis as unknown as {
  pgPool?: Pool;
};

export function getPool(): Pool {
  if (!globalForPg.pgPool) {
    globalForPg.pgPool = new Pool({
      connectionString: getDatabaseUrl(),
      max: 10,
    });
  }

  return globalForPg.pgPool;
}

export async function pingDatabase(): Promise<void> {
  await getPool().query("SELECT 1");
}
