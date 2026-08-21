import { NextResponse } from "next/server";
import { getPool } from "@/db/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getPool().query("SELECT 1");
    return NextResponse.json({ status: "ok", application: "ok", database: "ok" });
  } catch {
    return NextResponse.json(
      { status: "degraded", application: "ok", database: "error" },
      { status: 503 },
    );
  }
}
