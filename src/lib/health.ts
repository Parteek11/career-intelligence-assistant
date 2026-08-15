import "server-only";

import { pingDatabase } from "@/db/pool";
import { deriveOverallStatus } from "@/lib/health-status";
import type { CheckStatus, HealthResponse } from "@/types/health";

export async function getHealth(): Promise<HealthResponse> {
  const application: CheckStatus = "ok";
  let database: CheckStatus = "ok";

  try {
    await pingDatabase();
  } catch {
    database = "error";
  }

  return {
    status: deriveOverallStatus(application, database),
    application,
    database,
  };
}
