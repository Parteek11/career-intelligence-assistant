import { describe, expect, it } from "vitest";
import { deriveOverallStatus } from "@/lib/health-status";

describe("deriveOverallStatus", () => {
  it("returns ok when the application and database are both ok", () => {
    expect(deriveOverallStatus("ok", "ok")).toBe("ok");
  });

  it("returns degraded when the database check fails", () => {
    expect(deriveOverallStatus("ok", "error")).toBe("degraded");
  });
});
