"use client";

import type { ChangeEvent } from "react";
import { Briefcase, Eraser, FileText, Loader2 } from "lucide-react";
import { DocumentCard } from "@/components/workspace/DocumentCard";
import { ErrorAlert } from "@/components/workspace/ErrorAlert";
import { Button } from "@/components/ui/button";
import { JOB_SLOTS, type JobSlot } from "@/types/domain";

export type FileSlotState = {
  filename: string | null;
  busy: boolean;
  error: string | null;
};

export type JobSlotState = FileSlotState & {
  jobId: string | null;
};

type DocumentsSectionProps = {
  resume: FileSlotState;
  jobs: Record<JobSlot, JobSlotState>;
  clearing: boolean;
  clearError: string | null;
  onClearAll: () => void;
  onResumeUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onResumeDelete: () => void;
  onJobUpload: (slot: JobSlot, event: ChangeEvent<HTMLInputElement>) => void;
  onJobDelete: (slot: JobSlot) => void;
};

export function DocumentsSection({
  resume,
  jobs,
  clearing,
  clearError,
  onClearAll,
  onResumeUpload,
  onResumeDelete,
  onJobUpload,
  onJobDelete,
}: DocumentsSectionProps) {
  return (
    <section aria-labelledby="documents-heading" className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="documents-heading" className="text-lg font-semibold tracking-tight">
            Documents
          </h2>
          <p className="text-sm text-muted-foreground">
            Upload a resume and up to four job descriptions.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={onClearAll} disabled={clearing}>
          {clearing ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Eraser aria-hidden="true" />}
          {clearing ? "Clearing..." : "Clear all"}
        </Button>
      </div>

      {clearError && <ErrorAlert message={clearError} />}

      <div className="space-y-6">
        <div className="mx-auto flex w-full flex-col gap-3 sm:w-[100%] sm:flex-row sm:items-center sm:gap-6">
          <div className="shrink-0 sm:max-w-[14rem]">
            <h3 className="text-sm font-semibold">Candidate resume</h3>
            <p className="text-sm text-muted-foreground">Upload your resume here.</p>
          </div>
          <div className="min-w-0 flex-1">
            <DocumentCard
              title="Resume"
              icon={<FileText className="size-4" aria-hidden="true" />}
              filename={resume.filename}
              busy={resume.busy}
              error={resume.error}
              uploadLabel="Resume upload"
              onUpload={onResumeUpload}
              onDelete={onResumeDelete}
              layout="banner"
              uploadTone="resume"
            />
          </div>
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
                onUpload={(event) => onJobUpload(slot, event)}
                onDelete={() => onJobDelete(slot)}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
