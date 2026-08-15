import type { CheckStatus, OverallStatus } from "@/types/health";

export function deriveOverallStatus(
  application: CheckStatus,
  database: CheckStatus,
): OverallStatus {
  if (application === "ok" && database === "ok") {
    return "ok";
  }

  return "degraded";
}
