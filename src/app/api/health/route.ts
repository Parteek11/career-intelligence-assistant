import { NextResponse } from "next/server";
import { getHealth } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const health = await getHealth();
  const httpStatus = health.status === "ok" ? 200 : 503;

  return NextResponse.json(health, { status: httpStatus });
}
