"use client";

import { useEffect, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Briefcase,
  CheckCircle2,
  Eraser,
  FileText,
  ListChecks,
  Loader2,
  MessageCircleQuestion,
  Sparkles,
  Trash2,
  Trophy,
  Upload,
} from "lucide-react";
import type { BestMatchResult } from "@/generation/best-match-types";
import type { CareerAnalysis } from "@/generation/types";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type ResumeState = {
  filename: string | null;
  busy: boolean;
  error: string | null;
};

type JobState = {
  filename: string | null;
  jobId: string | null;
  busy: boolean;
  error: string | null;
};

const EMPTY_RESUME: ResumeState = { filename: null, busy: false, error: null };
const EMPTY_JOB: JobState = { filename: null, jobId: null, busy: false, error: null };
const JOB_SLOTS = [1, 2, 3, 4] as const;
type Slot = (typeof JOB_SLOTS)[number];

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

function formatCategoryLabel(category: string): string {
  return category
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (char) => char.toUpperCase())
    .trim();
}

function ErrorAlert({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertCircle aria-hidden="true" />
      <span>{message}</span>
    </Alert>
  );
}

type DocumentCardProps = {
  title: string;
  icon: ReactNode;
  filename: string | null;
  busy: boolean;
  error: string | null;
  uploadLabel: string;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onDelete: () => void;
  layout?: "stacked" | "banner";
  uploadTone?: "default" | "resume";
};

function DocumentCard({
  title,
  icon,
  filename,
  busy,
  error,
  uploadLabel,
  onUpload,
  onDelete,
  layout = "stacked",
  uploadTone = "default",
}: DocumentCardProps) {
  const uploadVariant =
    uploadTone === "resume" ? (filename ? "resumeOutline" : "resume") : filename ? "outline" : "default";

  const actions = (
    <div className="flex shrink-0 items-center gap-2">
      <div className="relative inline-flex">
        <input
          type="file"
          aria-label={uploadLabel}
          disabled={busy}
          onChange={onUpload}
          className="absolute inset-0 z-10 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        <Button type="button" variant={uploadVariant} size="sm" disabled={busy} tabIndex={-1}>
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
          {filename ? "Replace" : "Upload"}
        </Button>
      </div>
      {filename && (
        <Button type="button" variant="ghost" size="sm" onClick={onDelete} disabled={busy}>
          <Trash2 aria-hidden="true" />
          Delete
        </Button>
      )}
    </div>
  );

  if (layout === "banner") {
    return (
      <Card>
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-700">
              {icon}
            </span>
            <CardTitle>{title}</CardTitle>
            <Badge variant={filename ? "success" : "outline"}>{filename ? "Uploaded" : "Empty"}</Badge>
          </div>
          <div className="min-w-0 flex-1">
            {filename ? (
              <div className="flex items-center gap-2 text-sm">
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate" title={filename}>
                  {filename}
                </span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No file uploaded yet.</p>
            )}
          </div>
          {actions}
        </div>
        {error && (
          <div className="px-4 pb-2.5">
            <ErrorAlert message={error} />
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <div className="flex items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            {icon}
          </span>
          <CardTitle>{title}</CardTitle>
        </div>
        <Badge variant={filename ? "success" : "outline"}>{filename ? "Uploaded" : "Empty"}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {filename ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-sm">
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate" title={filename}>
              {filename}
            </span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No file uploaded yet.</p>
        )}
        {error && <ErrorAlert message={error} />}
      </CardContent>
      <CardFooter className="flex items-center gap-2">{actions}</CardFooter>
    </Card>
  );
}

export function CareerWorkspace() {
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [resume, setResume] = useState<ResumeState>(EMPTY_RESUME);
  const [jobs, setJobs] = useState<Record<Slot, JobState>>({
    1: EMPTY_JOB,
    2: EMPTY_JOB,
    3: EMPTY_JOB,
    4: EMPTY_JOB,
  });

  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  const [selectedTarget, setSelectedTarget] = useState<string>("all");
  const [question, setQuestion] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<CareerAnalysis | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const [findingBestMatch, setFindingBestMatch] = useState(false);
  const [bestMatches, setBestMatches] = useState<BestMatchResult[] | null>(null);
  const [bestMatchError, setBestMatchError] = useState<string | null>(null);

  const hasAnyJob = JOB_SLOTS.some((slot) => jobs[slot].filename !== null);

  // Reflect real server state (from a previous session or another tab)
  // instead of only actions taken in this session.
  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      try {
        const [resumeResponse, jobsResponse] = await Promise.all([
          fetch("/api/resume"),
          fetch("/api/jobs"),
        ]);

        if (cancelled) return;

        if (resumeResponse.ok) {
          const body = (await resumeResponse.json()) as { filename: string | null };
          setResume({ filename: body.filename, busy: false, error: null });
        }

        if (jobsResponse.ok) {
          const body = (await jobsResponse.json()) as {
            jobs: { slot: Slot; jobId: string; filename: string }[];
          };
          setJobs((state) => {
            const next = { ...state };
            for (const slot of JOB_SLOTS) {
              next[slot] = EMPTY_JOB;
            }
            for (const job of body.jobs) {
              next[job.slot] = { filename: job.filename, jobId: job.jobId, busy: false, error: null };
            }
            return next;
          });
        }
      } finally {
        if (!cancelled) {
          setLoadingStatus(false);
        }
      }
    }

    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  // If the job currently targeted by the selector disappears (deleted or
  // cleared), fall back to "All jobs" rather than leaving a stale selection.
  useEffect(() => {
    if (selectedTarget !== "all" && !jobs[Number(selectedTarget) as Slot].filename) {
      setSelectedTarget("all");
    }
  }, [jobs, selectedTarget]);

  async function handleResumeUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setResume({ filename: null, busy: true, error: null });
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/resume", { method: "POST", body: formData });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Resume upload failed"));
      }
      setResume({ filename: file.name, busy: false, error: null });
    } catch (error) {
      setResume({
        filename: null,
        busy: false,
        error: error instanceof Error ? error.message : "Resume upload failed",
      });
    }
  }

  async function handleResumeDelete() {
    setResume((state) => ({ ...state, busy: true, error: null }));
    try {
      const response = await fetch("/api/resume", { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Resume delete failed"));
      }
      setResume(EMPTY_RESUME);
    } catch (error) {
      setResume((state) => ({
        ...state,
        busy: false,
        error: error instanceof Error ? error.message : "Resume delete failed",
      }));
    }
  }

  async function handleJobUpload(slot: Slot, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setJobs((state) => ({ ...state, [slot]: { ...EMPTY_JOB, busy: true } }));
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`/api/jobs/${slot}`, { method: "POST", body: formData });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Job upload failed"));
      }
      const body = (await response.json()) as { jobId: string };
      setJobs((state) => ({
        ...state,
        [slot]: { filename: file.name, jobId: body.jobId, busy: false, error: null },
      }));
    } catch (error) {
      setJobs((state) => ({
        ...state,
        [slot]: {
          filename: null,
          jobId: null,
          busy: false,
          error: error instanceof Error ? error.message : "Job upload failed",
        },
      }));
    }
  }

  async function handleJobDelete(slot: Slot) {
    setJobs((state) => ({ ...state, [slot]: { ...state[slot], busy: true, error: null } }));
    try {
      const response = await fetch(`/api/jobs/${slot}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Job delete failed"));
      }
      setJobs((state) => ({ ...state, [slot]: EMPTY_JOB }));
    } catch (error) {
      setJobs((state) => ({
        ...state,
        [slot]: {
          ...state[slot],
          busy: false,
          error: error instanceof Error ? error.message : "Job delete failed",
        },
      }));
    }
  }

  async function handleClearAll() {
    setClearing(true);
    setClearError(null);
    try {
      const response = await fetch("/api/clear", { method: "POST" });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Clear all failed"));
      }
      setResume(EMPTY_RESUME);
      setJobs({ 1: EMPTY_JOB, 2: EMPTY_JOB, 3: EMPTY_JOB, 4: EMPTY_JOB });
      setSelectedTarget("all");
      setQuestion("");
      setAnalysis(null);
      setAnalyzeError(null);
      setBestMatches(null);
      setBestMatchError(null);
    } catch (error) {
      setClearError(error instanceof Error ? error.message : "Clear all failed");
    } finally {
      setClearing(false);
    }
  }

  async function handleAsk() {
    setAnalyzeError(null);
    setAnalysis(null);

    if (!resume.filename) {
      setAnalyzeError("Upload a resume before asking a question.");
      return;
    }
    if (selectedTarget !== "all" && !jobs[Number(selectedTarget) as Slot].filename) {
      setAnalyzeError(`Upload Job ${selectedTarget} before selecting it.`);
      return;
    }
    if (selectedTarget === "all" && !hasAnyJob) {
      setAnalyzeError("Upload at least one job description before asking a question.");
      return;
    }
    if (!question.trim()) {
      setAnalyzeError("Enter a question before asking.");
      return;
    }

    setAnalyzing(true);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, target: selectedTarget }),
      });
      const body = (await response.json()) as CareerAnalysis & { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Analysis failed");
      }
      setAnalysis(body);
    } catch (error) {
      setAnalyzeError(error instanceof Error ? error.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleFindBestMatch() {
    setBestMatchError(null);
    setBestMatches(null);

    if (!hasAnyJob) {
      setBestMatchError("Upload at least one job description before finding the best match.");
      return;
    }

    setFindingBestMatch(true);
    try {
      const response = await fetch("/api/best-match", { method: "POST" });
      const body = (await response.json()) as { results?: BestMatchResult[]; error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Best match analysis failed");
      }
      setBestMatches(body.results ?? []);
    } catch (error) {
      setBestMatchError(error instanceof Error ? error.message : "Best match analysis failed");
    } finally {
      setFindingBestMatch(false);
    }
  }

  function describeSource(source: CareerAnalysis["sources"][number]): string {
    if (source.documentType === "resume") {
      return "resume";
    }
    const slot = JOB_SLOTS.find((candidate) => jobs[candidate].jobId === source.jobId);
    return slot ? `Job ${slot}` : "job (unknown slot)";
  }

  if (loadingStatus) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border p-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading current resume and job status...
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* Documents */}
      <section aria-labelledby="documents-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="documents-heading" className="text-lg font-semibold tracking-tight">
              Documents
            </h2>
            <p className="text-sm text-muted-foreground">
              Upload a resume and up to four job descriptions.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={handleClearAll} disabled={clearing}>
            {clearing ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Eraser aria-hidden="true" />
            )}
            {clearing ? "Clearing..." : "Clear all"}
          </Button>
        </div>

        {clearError && <ErrorAlert message={clearError} />}

        <div className="space-y-6">
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Candidate resume</h3>
              <p className="text-sm text-muted-foreground">
                Upload one resume. Analysis and best-match both use this document.
              </p>
            </div>
            <DocumentCard
              title="Resume"
              icon={<FileText className="size-4" aria-hidden="true" />}
              filename={resume.filename}
              busy={resume.busy}
              error={resume.error}
              uploadLabel="Resume upload"
              onUpload={handleResumeUpload}
              onDelete={handleResumeDelete}
              layout="banner"
              uploadTone="resume"
            />
          </div>

          <div className="border-t border-border" aria-hidden="true" />

          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Job descriptions</h3>
              <p className="text-sm text-muted-foreground">
                Upload up to four roles. Each slot can be replaced or deleted independently.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {JOB_SLOTS.map((slot) => (
                <DocumentCard
                  key={slot}
                  title={`Job ${slot}`}
                  icon={<Briefcase className="size-4" aria-hidden="true" />}
                  filename={jobs[slot].filename}
                  busy={jobs[slot].busy}
                  error={jobs[slot].error}
                  uploadLabel={`Job ${slot} upload`}
                  onUpload={(event) => handleJobUpload(slot, event)}
                  onDelete={() => handleJobDelete(slot)}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Analysis */}
      <section aria-labelledby="analysis-heading" className="space-y-4">
        <div>
          <h2 id="analysis-heading" className="text-lg font-semibold tracking-tight">
            Analysis
          </h2>
          <p className="text-sm text-muted-foreground">
            Ask a question about career fit, or compare every uploaded job at once.
          </p>
        </div>

        <Card>
          <CardContent className="space-y-4 pt-4">
            <div className="w-full space-y-1.5 sm:w-[30%]">
              <Label>Target</Label>
              <Select
                aria-label="Job selector"
                value={selectedTarget}
                onChange={(event) => setSelectedTarget(event.target.value)}
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
                onChange={(event) => setQuestion(event.target.value)}
                rows={3}
              />
            </div>

            {analyzeError && <ErrorAlert message={analyzeError} />}
            {bestMatchError && <ErrorAlert message={bestMatchError} />}

            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={handleAsk} disabled={analyzing}>
                {analyzing ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles aria-hidden="true" />
                )}
                {analyzing ? "Analyzing..." : "Analyze"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handleFindBestMatch}
                disabled={findingBestMatch}
              >
                {findingBestMatch ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Trophy aria-hidden="true" />
                )}
                {findingBestMatch ? "Finding best match..." : "Find Best Match"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Results */}
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
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {analysis.experienceAlignment}
                </p>
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
                      job: {describeSource(source)} — chunkIndex: {source.chunkIndex} — similarity:{" "}
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
    </div>
  );
}
