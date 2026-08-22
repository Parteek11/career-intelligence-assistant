"use client";

import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { Loader2 } from "lucide-react";
import { AnalysisSection } from "@/components/workspace/AnalysisSection";
import {
  DocumentsSection,
  type FileSlotState,
  type JobSlotState,
} from "@/components/workspace/DocumentsSection";
import { ResultsSection } from "@/components/workspace/ResultsSection";
import type { BestMatchResult, CareerAnalysis, CareerAskResult } from "@/generation/types";
import { JOB_SLOTS, type JobSlot } from "@/types/domain";

const EMPTY_RESUME: FileSlotState = { filename: null, busy: false, error: null };
const EMPTY_JOB: JobSlotState = { filename: null, jobId: null, busy: false, error: null };

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export function CareerWorkspace() {
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [resume, setResume] = useState<FileSlotState>(EMPTY_RESUME);
  const [jobs, setJobs] = useState<Record<JobSlot, JobSlotState>>({
    1: EMPTY_JOB,
    2: EMPTY_JOB,
    3: EMPTY_JOB,
    4: EMPTY_JOB,
  });
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState("all");
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [askResult, setAskResult] = useState<CareerAskResult | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<CareerAnalysis | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [findingBestMatch, setFindingBestMatch] = useState(false);
  const [bestMatches, setBestMatches] = useState<BestMatchResult[] | null>(null);
  const [bestMatchError, setBestMatchError] = useState<string | null>(null);

  const hasAnyJob = JOB_SLOTS.some((slot) => jobs[slot].filename !== null);

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
            jobs: { slot: JobSlot; jobId: string; filename: string }[];
          };
          setJobs(() => {
            const next = { 1: EMPTY_JOB, 2: EMPTY_JOB, 3: EMPTY_JOB, 4: EMPTY_JOB };
            for (const job of body.jobs) {
              next[job.slot] = { filename: job.filename, jobId: job.jobId, busy: false, error: null };
            }
            return next;
          });
        }
      } finally {
        if (!cancelled) setLoadingStatus(false);
      }
    }

    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (selectedTarget !== "all" && !jobs[Number(selectedTarget) as JobSlot].filename) {
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
      if (!response.ok) throw new Error(await readErrorMessage(response, "Resume upload failed"));
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
      if (!response.ok) throw new Error(await readErrorMessage(response, "Resume delete failed"));
      setResume(EMPTY_RESUME);
    } catch (error) {
      setResume((state) => ({
        ...state,
        busy: false,
        error: error instanceof Error ? error.message : "Resume delete failed",
      }));
    }
  }

  async function handleJobUpload(slot: JobSlot, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setJobs((state) => ({ ...state, [slot]: { ...EMPTY_JOB, busy: true } }));
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`/api/jobs/${slot}`, { method: "POST", body: formData });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Job upload failed"));
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

  async function handleJobDelete(slot: JobSlot) {
    setJobs((state) => ({ ...state, [slot]: { ...state[slot], busy: true, error: null } }));
    try {
      const response = await fetch(`/api/jobs/${slot}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Job delete failed"));
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
      if (!response.ok) throw new Error(await readErrorMessage(response, "Clear all failed"));
      setResume(EMPTY_RESUME);
      setJobs({ 1: EMPTY_JOB, 2: EMPTY_JOB, 3: EMPTY_JOB, 4: EMPTY_JOB });
      setSelectedTarget("all");
      setQuestion("");
      setAskResult(null);
      setAskError(null);
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

  function clearResults() {
    setAskResult(null);
    setAskError(null);
    setAnalysis(null);
    setAnalyzeError(null);
    setBestMatches(null);
    setBestMatchError(null);
  }

  async function handleAsk() {
    clearResults();

    if (!resume.filename) {
      setAskError("Upload a resume before asking a question.");
      return;
    }
    if (selectedTarget !== "all" && !jobs[Number(selectedTarget) as JobSlot].filename) {
      setAskError(`Upload Job ${selectedTarget} before selecting it.`);
      return;
    }
    if (selectedTarget === "all" && !hasAnyJob) {
      setAskError("Upload at least one job description before asking a question.");
      return;
    }
    if (!question.trim()) {
      setAskError("Enter a question before asking.");
      return;
    }

    setAsking(true);
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, target: selectedTarget }),
      });
      const body = (await response.json()) as CareerAskResult & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Ask failed");
      setAskResult(body);
    } catch (error) {
      setAskError(error instanceof Error ? error.message : "Ask failed");
    } finally {
      setAsking(false);
    }
  }

  async function handleAnalyze() {
    clearResults();

    if (selectedTarget === "all") {
      setAnalyzeError("Select a specific job before analyzing.");
      return;
    }
    if (!resume.filename) {
      setAnalyzeError("Upload a resume before analyzing.");
      return;
    }
    if (!jobs[Number(selectedTarget) as JobSlot].filename) {
      setAnalyzeError(`Upload Job ${selectedTarget} before selecting it.`);
      return;
    }

    setAnalyzing(true);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: selectedTarget }),
      });
      const body = (await response.json()) as CareerAnalysis & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Analysis failed");
      setAnalysis(body);
    } catch (error) {
      setAnalyzeError(error instanceof Error ? error.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleFindBestMatch() {
    clearResults();

    if (!hasAnyJob) {
      setBestMatchError("Upload at least one job description before finding the best match.");
      return;
    }

    setFindingBestMatch(true);
    try {
      const response = await fetch("/api/best-match", { method: "POST" });
      const body = (await response.json()) as { results?: BestMatchResult[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Best match analysis failed");
      setBestMatches(body.results ?? []);
    } catch (error) {
      setBestMatchError(error instanceof Error ? error.message : "Best match analysis failed");
    } finally {
      setFindingBestMatch(false);
    }
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
      <DocumentsSection
        resume={resume}
        jobs={jobs}
        clearing={clearing}
        clearError={clearError}
        onClearAll={handleClearAll}
        onResumeUpload={handleResumeUpload}
        onResumeDelete={handleResumeDelete}
        onJobUpload={handleJobUpload}
        onJobDelete={handleJobDelete}
      />
      <AnalysisSection
        jobs={jobs}
        selectedTarget={selectedTarget}
        question={question}
        asking={asking}
        analyzing={analyzing}
        findingBestMatch={findingBestMatch}
        askError={askError}
        analyzeError={analyzeError}
        bestMatchError={bestMatchError}
        onTargetChange={setSelectedTarget}
        onQuestionChange={setQuestion}
        onAsk={handleAsk}
        onAnalyze={handleAnalyze}
        onFindBestMatch={handleFindBestMatch}
      />
      <ResultsSection jobs={jobs} askResult={askResult} analysis={analysis} bestMatches={bestMatches} />
    </div>
  );
}
