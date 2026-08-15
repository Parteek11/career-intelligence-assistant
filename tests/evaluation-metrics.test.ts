import { describe, expect, it } from "vitest";
import {
  average,
  averageDefined,
  computeLabeledMetrics,
  conceptHitRate,
  isRelevantItem,
  jobCoverage,
  jobFilterAccuracy,
  precisionAtK,
  recallAtK,
} from "../evaluation/retrieval/metrics";
import {
  buildChunkingExperimentReport,
  CHUNKING_EXPERIMENT_CONFIGS,
  isChunkingExperimentReport,
} from "../evaluation/retrieval/chunking-experiment";
import type { RetrievedItemForEval } from "../evaluation/retrieval/types";

const JOB_1 = "job-1-uuid";
const JOB_2 = "job-2-uuid";

function resumeItem(content = "Built TypeScript APIs with PostgreSQL."): RetrievedItemForEval {
  return { content, documentType: "resume", jobId: null, similarity: 0.8 };
}

function jobItem(jobId: string, content: string, similarity = 0.8): RetrievedItemForEval {
  return { content, documentType: "job_description", jobId, similarity };
}

describe("isRelevantItem", () => {
  it("accepts a resume item when resume is an expected document type", () => {
    expect(isRelevantItem(resumeItem(), ["resume"], new Set())).toBe(true);
  });

  it("rejects an item whose document type is not expected", () => {
    expect(isRelevantItem(resumeItem(), ["job_description"], new Set())).toBe(false);
  });

  it("accepts a job item only when its job id is in the expected set", () => {
    const item = jobItem(JOB_1, "Requires TypeScript.");
    expect(isRelevantItem(item, ["job_description"], new Set([JOB_1]))).toBe(true);
    expect(isRelevantItem(item, ["job_description"], new Set([JOB_2]))).toBe(false);
  });

  it("accepts any job item when no job restriction is given", () => {
    const item = jobItem(JOB_1, "Requires TypeScript.");
    expect(isRelevantItem(item, ["job_description"], new Set())).toBe(true);
  });
});

describe("precisionAtK", () => {
  it("computes the fraction of retrieved items that are relevant", () => {
    const retrieved = [
      resumeItem(),
      jobItem(JOB_1, "Requires TypeScript."),
      jobItem(JOB_2, "Requires marketing skills."), // contamination: wrong job
      jobItem(JOB_1, "Requires PostgreSQL."),
    ];

    const precision = precisionAtK(retrieved, ["resume", "job_description"], new Set([JOB_1]));
    expect(precision).toBe(3 / 4);
  });

  it("returns 0 for an empty result set", () => {
    expect(precisionAtK([], ["resume"], new Set())).toBe(0);
  });

  it("returns 1 when every retrieved item is relevant", () => {
    const retrieved = [resumeItem(), jobItem(JOB_1, "Requires TypeScript.")];
    const precision = precisionAtK(retrieved, ["resume", "job_description"], new Set([JOB_1]));
    expect(precision).toBe(1);
  });
});

describe("recallAtK", () => {
  it("computes the fraction of the known relevant pool that was retrieved", () => {
    const retrieved = [resumeItem(), jobItem(JOB_1, "Requires TypeScript.")];
    // Suppose the corpus actually has 4 relevant chunks in total (resume +
    // job_1), but only 2 were retrieved in the top-K.
    const recall = recallAtK(retrieved, ["resume", "job_description"], new Set([JOB_1]), 4);
    expect(recall).toBe(2 / 4);
  });

  it("treats a question with no relevant chunks available as trivially satisfied", () => {
    expect(recallAtK([], ["resume"], new Set(), 0)).toBe(1);
  });

  it("caps recall at 1 even if more relevant items were retrieved than expected", () => {
    const retrieved = [resumeItem(), resumeItem(), resumeItem()];
    const recall = recallAtK(retrieved, ["resume"], new Set(), 1);
    expect(recall).toBe(1);
  });
});

describe("jobFilterAccuracy (cross-job contamination detection)", () => {
  it("detects a filtering failure when a wrong-job chunk is present", () => {
    const retrieved = [
      jobItem(JOB_1, "Requires TypeScript."),
      jobItem(JOB_2, "Requires marketing skills."),
    ];

    const accuracy = jobFilterAccuracy(retrieved, new Set([JOB_1]));
    expect(accuracy).toBe(0.5);
    expect(accuracy).toBeLessThan(1);
  });

  it("scores 1 when every job chunk belongs to an expected job", () => {
    const retrieved = [resumeItem(), jobItem(JOB_1, "Requires TypeScript.")];
    expect(jobFilterAccuracy(retrieved, new Set([JOB_1]))).toBe(1);
  });

  it("is vacuously 1 when the question has no job restriction", () => {
    const retrieved = [jobItem(JOB_1, "a"), jobItem(JOB_2, "b")];
    expect(jobFilterAccuracy(retrieved, new Set())).toBe(1);
  });
});

describe("jobCoverage (All Jobs)", () => {
  it("is 1 when every expected job appears among retrieved job IDs", () => {
    const retrieved = [
      jobItem(JOB_1, "Backend role."),
      jobItem(JOB_2, "Frontend role."),
      jobItem(JOB_1, "More backend."),
    ];

    expect(jobCoverage(retrieved, new Set([JOB_1, JOB_2]))).toBe(1);
  });

  it("is the fraction of expected jobs that were retrieved", () => {
    const retrieved = [jobItem(JOB_2, "Frontend role.")];
    expect(jobCoverage(retrieved, new Set([JOB_1, JOB_2]))).toBe(0.5);
  });

  it("does not penalize extra retrieved jobs", () => {
    const retrieved = [
      jobItem(JOB_1, "Backend."),
      jobItem(JOB_2, "Frontend."),
    ];

    expect(jobCoverage(retrieved, new Set([JOB_1]))).toBe(1);
  });

  it("is 0 when none of the expected jobs were retrieved", () => {
    const retrieved = [jobItem(JOB_2, "Frontend role.")];
    expect(jobCoverage(retrieved, new Set([JOB_1]))).toBe(0);
  });

  it("is vacuously 1 when no jobs are expected", () => {
    expect(jobCoverage([jobItem(JOB_1, "a")], new Set())).toBe(1);
  });
});

describe("computeLabeledMetrics", () => {
  it("records jobCoverage and omits jobFilterAccuracy for All Jobs queries", () => {
    const retrieved = [
      jobItem(JOB_1, "Requires TypeScript."),
      jobItem(JOB_2, "Requires React."),
    ];

    const metrics = computeLabeledMetrics({
      isAllJobsQuery: true,
      retrieved,
      expectedDocumentTypes: ["job_description"],
      expectedJobIds: new Set([JOB_1]),
      expectedConcepts: ["TypeScript"],
      totalRelevantAvailable: 1,
    });

    expect(metrics.jobFilterAccuracy).toBeNull();
    expect(metrics.jobCoverage).toBe(1);
    expect(metrics.conceptHitRate).toBe(1);
  });

  it("records jobFilterAccuracy and omits jobCoverage for specific-job queries", () => {
    const retrieved = [
      jobItem(JOB_1, "Requires TypeScript."),
      jobItem(JOB_2, "Requires marketing skills."),
    ];

    const metrics = computeLabeledMetrics({
      isAllJobsQuery: false,
      retrieved,
      expectedDocumentTypes: ["job_description"],
      expectedJobIds: new Set([JOB_1]),
      expectedConcepts: ["TypeScript"],
      totalRelevantAvailable: 2,
    });

    expect(metrics.jobCoverage).toBeNull();
    expect(metrics.jobFilterAccuracy).toBe(0.5);
  });
});

describe("conceptHitRate", () => {
  it("computes the fraction of expected concepts found in retrieved content", () => {
    const retrieved = [
      resumeItem("Built TypeScript APIs with PostgreSQL."),
      jobItem(JOB_1, "Requires Node.js experience."),
    ];

    const rate = conceptHitRate(retrieved, ["TypeScript", "PostgreSQL", "AWS"]);
    expect(rate).toBeCloseTo(2 / 3, 5);
  });

  it("is case-insensitive", () => {
    const retrieved = [resumeItem("typescript and postgresql experience")];
    expect(conceptHitRate(retrieved, ["TypeScript", "PostgreSQL"])).toBe(1);
  });

  it("is vacuously 1 when no concepts are expected", () => {
    expect(conceptHitRate([], [])).toBe(1);
  });
});

describe("a correct retrieval produces the expected scores together", () => {
  it("scores perfectly across all four metrics for a well-formed result", () => {
    const retrieved = [
      resumeItem("Built TypeScript APIs with PostgreSQL."),
      jobItem(JOB_1, "Senior Backend Engineer requires TypeScript and PostgreSQL.", 0.9),
    ];
    const expectedDocumentTypes = ["resume", "job_description"];
    const expectedJobIds = new Set([JOB_1]);

    expect(precisionAtK(retrieved, expectedDocumentTypes, expectedJobIds)).toBe(1);
    expect(recallAtK(retrieved, expectedDocumentTypes, expectedJobIds, 2)).toBe(1);
    expect(jobFilterAccuracy(retrieved, expectedJobIds)).toBe(1);
    expect(conceptHitRate(retrieved, ["TypeScript", "PostgreSQL"])).toBe(1);
  });
});

describe("average", () => {
  it("computes the mean of a list of numbers", () => {
    expect(average([1, 2, 3])).toBe(2);
  });

  it("returns 0 for an empty list", () => {
    expect(average([])).toBe(0);
  });

  it("averages only defined values and returns null when none exist", () => {
    expect(averageDefined([1, null, 3])).toBe(2);
    expect(averageDefined([null, null])).toBeNull();
  });
});

describe("chunking experiment result structure", () => {
  it("includes the three experimental configurations and required fields", () => {
    expect(CHUNKING_EXPERIMENT_CONFIGS).toEqual([
      { chunkSize: 500, chunkOverlap: 75 },
      { chunkSize: 900, chunkOverlap: 120 },
      { chunkSize: 1200, chunkOverlap: 150 },
    ]);

    const report = buildChunkingExperimentReport({
      timestamp: "2026-08-15T00:00:00.000Z",
      datasetSize: 10,
      topK: 5,
      embeddingModel: "Xenova/all-MiniLM-L6-v2",
      configurations: CHUNKING_EXPERIMENT_CONFIGS.map((config) => ({
        ...config,
        precisionAt5: 0.6,
        recallAt5: 1,
        conceptHitRate: 0.9,
        averageLatencyMs: 4.2,
      })),
    });

    expect(isChunkingExperimentReport(report)).toBe(true);
    expect(report.configurations).toHaveLength(3);
    for (const configuration of report.configurations) {
      expect(configuration).toEqual(
        expect.objectContaining({
          chunkSize: expect.any(Number),
          chunkOverlap: expect.any(Number),
          precisionAt5: expect.any(Number),
          recallAt5: expect.any(Number),
          conceptHitRate: expect.any(Number),
          averageLatencyMs: expect.any(Number),
        }),
      );
    }
  });

  it("rejects a report missing required configuration fields", () => {
    expect(
      isChunkingExperimentReport({
        timestamp: "2026-08-15T00:00:00.000Z",
        datasetSize: 10,
        topK: 5,
        embeddingModel: "Xenova/all-MiniLM-L6-v2",
        configurations: [{ chunkSize: 900 }],
      }),
    ).toBe(false);
  });
});
