import { NextResponse } from "next/server";
import { GenerationError } from "@/generation/errors";
import { findBestMatch } from "@/services/best-match";
import { RetrievalError } from "@/services/retrieval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const results = await findBestMatch();
    return NextResponse.json({ results }, { status: 200 });
  } catch (error) {
    if (error instanceof GenerationError || error instanceof RetrievalError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Best match analysis failed" }, { status: 500 });
  }
}
