import { Pool, type PoolClient } from "pg";

export function createTestPool(): Pool {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required for schema tests. Copy .env.example to .env and start PostgreSQL.",
    );
  }

  return new Pool({ connectionString: databaseUrl, max: 2 });
}

export async function withRolledBackTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("ROLLBACK");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback failures after an aborted transaction.
    }
    throw error;
  } finally {
    client.release();
  }
}

export function isPostgresError(
  error: unknown,
): error is { code: string; message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  );
}
