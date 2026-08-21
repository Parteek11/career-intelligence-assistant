"use client";

import type { ChangeEvent, ReactNode } from "react";
import { FileText, Loader2, Trash2, Upload } from "lucide-react";
import { ErrorAlert } from "@/components/workspace/ErrorAlert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

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

export function DocumentCard({
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
