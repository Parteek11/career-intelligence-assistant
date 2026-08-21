import { NextResponse } from "next/server";
import { findBestMatch } from "@/services/analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const results = await findBestMatch();
    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Best match analysis failed" },
      { status: 400 },
    );
  }
}
