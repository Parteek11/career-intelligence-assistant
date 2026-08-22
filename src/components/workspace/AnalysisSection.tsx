"use client";

import { Loader2, MessageCircleQuestion, Sparkles, Trophy } from "lucide-react";
import { ErrorAlert } from "@/components/workspace/ErrorAlert";
import type { JobSlotState } from "@/components/workspace/DocumentsSection";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { JOB_SLOTS, type JobSlot } from "@/types/domain";

type AnalysisSectionProps = {
  jobs: Record<JobSlot, JobSlotState>;
  selectedTarget: string;
  question: string;
  asking: boolean;
  analyzing: boolean;
  findingBestMatch: boolean;
  askError: string | null;
  analyzeError: string | null;
  bestMatchError: string | null;
  onTargetChange: (value: string) => void;
  onQuestionChange: (value: string) => void;
  onAsk: () => void;
  onAnalyze: () => void;
  onFindBestMatch: () => void;
};

export function AnalysisSection({
  jobs,
  selectedTarget,
  question,
  asking,
  analyzing,
  findingBestMatch,
  askError,
  analyzeError,
  bestMatchError,
  onTargetChange,
  onQuestionChange,
  onAsk,
  onAnalyze,
  onFindBestMatch,
}: AnalysisSectionProps) {
  const busy = asking || analyzing || findingBestMatch;
  const analyzeDisabled = busy || selectedTarget === "all";

  return (
    <section aria-labelledby="analysis-heading" className="space-y-4">
      <div>
        <h2 id="analysis-heading" className="text-lg font-semibold tracking-tight">
          Analysis
        </h2>
        <p className="text-sm text-muted-foreground">
          Ask a specific question, or analyze one selected job against the resume.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-4">
          <div className="w-full space-y-1.5 sm:w-[30%]">
            <Label>Target</Label>
            <Select
              aria-label="Job selector"
              value={selectedTarget}
              onChange={(event) => onTargetChange(event.target.value)}
            >
              <option value="all">All jobs</option>
              {JOB_SLOTS.map((slot) => (
                <option key={slot} value={String(slot)} disabled={!jobs[slot].filename}>
                  Job {slot}
                  {!jobs[slot].filename ? " (no JD uploaded)" : ""}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Question</Label>
            <Textarea
              aria-label="Question input"
              placeholder="What skills am I missing for this role?"
              value={question}
              onChange={(event) => onQuestionChange(event.target.value)}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              Used by Ask only. Analyze compares the resume to the selected job and ignores this box.
            </p>
          </div>

          {askError && <ErrorAlert message={askError} />}
          {analyzeError && <ErrorAlert message={analyzeError} />}
          {bestMatchError && <ErrorAlert message={bestMatchError} />}

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={onAsk} disabled={busy}>
              {asking ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <MessageCircleQuestion aria-hidden="true" />
              )}
              {asking ? "Asking..." : "Ask"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={onAnalyze}
              disabled={analyzeDisabled}
              title={
                selectedTarget === "all"
                  ? "Select a specific job to analyze"
                  : undefined
              }
            >
              {analyzing ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles aria-hidden="true" />
              )}
              {analyzing ? "Analyzing..." : "Analyze"}
            </Button>
            <Button type="button" variant="secondary" onClick={onFindBestMatch} disabled={busy}>
              {findingBestMatch ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Trophy aria-hidden="true" />
              )}
              {findingBestMatch ? "Finding best match..." : "Find Best Match"}
            </Button>
          </div>
          {selectedTarget === "all" && (
            <p className="text-xs text-muted-foreground">
              Analyze is available when a single job is selected.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
