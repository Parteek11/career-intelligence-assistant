import { NextResponse } from "next/server";
import { clearAll } from "@/services/document-management";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  await clearAll();
  return NextResponse.json({ ok: true });
}
