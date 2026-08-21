"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ListChecks,
  MessageCircleQuestion,
  Sparkles,
  Trophy,
} from "lucide-react";
import type { JobSlotState } from "@/components/workspace/DocumentsSection";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { BestMatchResult, CareerAnalysis } from "@/generation/types";
import { JOB_SLOTS, type JobSlot } from "@/types/domain";

function formatCategoryLabel(category: string): string {
  return category
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (char) => char.toUpperCase())
    .trim();
}

function describeSource(
  source: CareerAnalysis["sources"][number],
  jobs: Record<JobSlot, JobSlotState>,
): string {
  if (source.documentType === "resume") return "resume";
  const slot = JOB_SLOTS.find((candidate) => jobs[candidate].jobId === source.jobId);
  return slot ? `Job ${slot}` : "job (unknown slot)";
}

type ResultsSectionProps = {
  jobs: Record<JobSlot, JobSlotState>;
  analysis: CareerAnalysis | null;
  bestMatches: BestMatchResult[] | null;
};

export function ResultsSection({ jobs, analysis, bestMatches }: ResultsSectionProps) {
  return (
    <section aria-labelledby="results-heading" className="space-y-4">
      <h2 id="results-heading" className="text-lg font-semibold tracking-tight">
        Results
      </h2>

      {!analysis && !bestMatches && (
        <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          Run an analysis or find the best match to see results here.
        </p>
      )}

      {analysis && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4" aria-hidden="true" />
              Analysis result
            </CardTitle>
            <CardDescription>Grounded in the resume and selected job evidence only.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold">Answer</h3>
              <p className="text-sm leading-relaxed">{analysis.answer}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                  Strengths
                </h3>
                <ul className="space-y-1 text-sm">
                  {analysis.strengths.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="space-y-1.5">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-amber-700">
                  <AlertTriangle className="size-4" aria-hidden="true" />
                  Skill gaps
                </h3>
                <ul className="space-y-1 text-sm">
                  {analysis.skillGaps.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold">Experience alignment</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{analysis.experienceAlignment}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                  <MessageCircleQuestion className="size-4" aria-hidden="true" />
                  Interview preparation
                </h3>
                <ul className="space-y-1 text-sm">
                  {analysis.interviewPreparation.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="space-y-1.5">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                  <ListChecks className="size-4" aria-hidden="true" />
                  Recommendations
                </h3>
                <ul className="space-y-1 text-sm">
                  {analysis.recommendations.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Sources</h3>
              <ul className="space-y-1.5">
                {analysis.sources.map((source, index) => (
                  <li
                    key={index}
                    className="rounded-md border border-border bg-muted/40 px-2.5 py-2 text-xs text-muted-foreground"
                  >
                    filename: {source.filename ?? "unknown"} — documentType: {source.documentType} —
                    job: {describeSource(source, jobs)} — chunkIndex: {source.chunkIndex} — similarity:{" "}
                    {source.similarity.toFixed(3)}
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {bestMatches && bestMatches.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          No jobs could be compared yet.
        </p>
      )}

      {bestMatches && bestMatches.length > 0 && (
        <div className="space-y-3">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Trophy className="size-4" aria-hidden="true" />
            Best match ranking
          </h3>
          {bestMatches.map((match, index) => (
            <Card key={match.jobId}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                <div className="flex items-center gap-2">
                  <Badge variant={index === 0 ? "success" : "outline"}>Job {match.jobSlot}</Badge>
                  {index === 0 && (
                    <Badge variant="secondary" className="gap-1">
                      <Trophy className="size-3" aria-hidden="true" />
                      Top match
                    </Badge>
                  )}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-lg font-semibold leading-none">{match.score}</span>
                  <span className="text-xs text-muted-foreground">/100</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.min(Math.max(match.score, 0), 100)}%` }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {Object.entries(match.categoryScores).map(([category, score]) => (
                    <div
                      key={category}
                      className="rounded-md border border-border bg-muted/40 px-2 py-1.5 text-center"
                    >
                      <p className="text-[11px] leading-tight text-muted-foreground">
                        {formatCategoryLabel(category)}
                      </p>
                      <p className="text-sm font-semibold">{score}</p>
                    </div>
                  ))}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <h4 className="text-xs font-semibold text-emerald-700">Strengths</h4>
                    <p className="text-sm">{match.strengths.join("; ") || "none"}</p>
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-xs font-semibold text-amber-700">Skill gaps</h4>
                    <p className="text-sm">{match.skillGaps.join("; ") || "none"}</p>
                  </div>
                </div>

                <div className="space-y-1">
                  <h4 className="text-xs font-semibold">Reasoning</h4>
                  <p className="text-sm text-muted-foreground">{match.reasoning}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
