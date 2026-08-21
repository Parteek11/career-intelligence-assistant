import { NextResponse } from "next/server";
import { getJobBySlot } from "@/db/repositories/jobs";
import { analyzeCareerFit } from "@/services/analysis";
import { isJobSlot } from "@/types/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AnalyzeRequestBody = {
  question: string;
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
    return NextResponse.json(analysis);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analysis failed" },
      { status: 400 },
    );
  }
}

async function resolveTargetJobId(target: string): Promise<string | "all" | "not_found"> {
  if (target === "all") return "all";
  const slot = Number(target);
  if (!isJobSlot(slot)) return "not_found";
  const job = await getJobBySlot(slot);
  return job ? job.id : "not_found";
}

function isValidBody(value: unknown): value is AnalyzeRequestBody {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.question !== "string" || record.question.trim().length === 0) return false;
  if (typeof record.target !== "string") return false;
  return record.target === "all" || isJobSlot(Number(record.target));
}
