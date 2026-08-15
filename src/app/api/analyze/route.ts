import { NextResponse } from "next/server";
import { getJobBySlot } from "@/db/repositories/jobs";
import { GenerationError } from "@/generation/errors";
import { analyzeCareerFit } from "@/services/career-analysis";
import { RetrievalError } from "@/services/retrieval";
import { isJobSlot } from "@/types/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AnalyzeRequestBody = {
  question: string;
  /** "1" | "2" | "3" | "4" | "all" — the UI's job selector value. */
  target: string;
};

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  if (!isValidBody(body)) {
    return NextResponse.json(
      { error: 'question (non-empty string) and target ("1"-"4" or "all") are required' },
      { status: 400 },
    );
  }

  const targetJobId = await resolveTargetJobId(body.target);
  if (targetJobId === "not_found") {
    return NextResponse.json(
      { error: `No job description has been uploaded for Job ${body.target}` },
      { status: 404 },
    );
  }

  try {
    const analysis = await analyzeCareerFit({ question: body.question, targetJobId });
    return NextResponse.json(analysis, { status: 200 });
  } catch (error) {
    if (error instanceof RetrievalError || error instanceof GenerationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}

/**
 * Translates the UI's slot-based selection ("1"-"4" or "all") into the
 * job id that retrieveCareerEvidence/analyzeCareerFit already expect. This
 * is the only new logic here — "all" is passed straight through unchanged,
 * so retrieval behavior for "All Jobs" is exactly what already exists.
 */
async function resolveTargetJobId(target: string): Promise<string | "all" | "not_found"> {
  if (target === "all") {
    return "all";
  }

  const slot = Number(target);
  if (!isJobSlot(slot)) {
    return "not_found";
  }

  const job = await getJobBySlot(slot);
  return job ? job.id : "not_found";
}

function isValidBody(value: unknown): value is AnalyzeRequestBody {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.question !== "string" || record.question.trim().length === 0) {
    return false;
  }

  if (typeof record.target !== "string") {
    return false;
  }

  return record.target === "all" || isJobSlot(Number(record.target));
}
