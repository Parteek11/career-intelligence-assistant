import "server-only";

import { randomUUID } from "node:crypto";

export type LogLevel = "info" | "warn" | "error";

export type StructuredLogRecord = {
  timestamp: string;
  level: LogLevel;
  operation: string;
  [key: string]: unknown;
};

export type ObservabilitySink = (record: StructuredLogRecord) => void;

/**
 * Keys that must never appear in a log record. Compared after lowercasing
 * and stripping non-alphanumerics so `apiKey`, `api_key`, and `pageContent`
 * are all blocked. Token-usage fields (`promptTokens`, etc.) are not in
 * this list and are safe to emit.
 */
const BLOCKED_KEYS = new Set([
  "content",
  "pagecontent",
  "text",
  "prompt",
  "system",
  "user",
  "answer",
  "apikey",
  "authorization",
  "password",
  "secret",
  "resume",
  "jobdescription",
  "messages",
  "generated",
  "generatedtext",
  "fulltext",
]);

function defaultSink(record: StructuredLogRecord): void {
  console.info(JSON.stringify(record));
}

let sink: ObservabilitySink = defaultSink;

/**
 * Replace the log backend. The default writes one JSON object per line to
 * stdout. Swap this later for OpenTelemetry, CloudWatch, or LangSmith
 * without changing callers.
 */
export function setObservabilitySink(next: ObservabilitySink | null): void {
  sink = next ?? defaultSink;
}

export function resetObservabilitySink(): void {
  sink = defaultSink;
}

export function createQueryId(): string {
  return randomUUID();
}

/** Returns a function that reports milliseconds since this call. */
export function startTimer(): () => number {
  const started = performance.now();
  return () => Math.round(performance.now() - started);
}

export async function measure<T>(
  fn: () => Promise<T> | T,
): Promise<{ value: T; durationMs: number }> {
  const elapsed = startTimer();
  const value = await fn();
  return { value, durationMs: elapsed() };
}

export function logEvent(
  fields: Omit<StructuredLogRecord, "timestamp" | "level"> & {
    timestamp?: string;
    level?: LogLevel;
  },
): void {
  const record = sanitizeLogFields({
    timestamp: fields.timestamp ?? new Date().toISOString(),
    level: fields.level ?? "info",
    ...fields,
  }) as StructuredLogRecord;

  sink(record);
}

export function sanitizeLogFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogFields(item));
  }

  if (value !== null && typeof value === "object") {
    const sanitized: Record<string, unknown> = {};

    for (const [key, nested] of Object.entries(value)) {
      if (isBlockedKey(key)) {
        continue;
      }
      sanitized[key] = sanitizeLogFields(nested);
    }

    return sanitized;
  }

  if (typeof value === "string" && looksLikeSecret(value)) {
    return "[redacted]";
  }

  return value;
}

function isBlockedKey(key: string): boolean {
  return BLOCKED_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

function looksLikeSecret(value: string): boolean {
  return /gsk_[A-Za-z0-9]+/.test(value) || /^Bearer\s+\S+/i.test(value);
}

export type GenerationLogFields = {
  queryId: string;
  selectedJob: string;
  retrievedResultCount: number;
  durationMs: number;
  success: boolean;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export function logGenerationEvent(fields: GenerationLogFields): void {
  logEvent({
    operation: "generation",
    model: fields.model ?? "unknown",
    durationMs: fields.durationMs,
    success: fields.success,
    queryId: fields.queryId,
    selectedJob: fields.selectedJob,
    retrievedResultCount: fields.retrievedResultCount,
    ...(typeof fields.promptTokens === "number" ? { promptTokens: fields.promptTokens } : {}),
    ...(typeof fields.completionTokens === "number"
      ? { completionTokens: fields.completionTokens }
      : {}),
    ...(typeof fields.totalTokens === "number" ? { totalTokens: fields.totalTokens } : {}),
  });
}
