export type CheckStatus = "ok" | "error";
export type OverallStatus = "ok" | "degraded";

export type HealthResponse = {
  status: OverallStatus;
  application: CheckStatus;
  database: CheckStatus;
};
