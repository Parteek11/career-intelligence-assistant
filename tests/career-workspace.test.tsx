// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CareerWorkspace } from "@/components/CareerWorkspace";

type FetchOverrides = {
  resume?: unknown;
  jobs?: unknown;
  analyze?: () => Response;
  bestMatch?: () => Response;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetchMock(overrides: FetchOverrides = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";

    if (url === "/api/resume" && method === "GET") {
      return jsonResponse(overrides.resume ?? { filename: null });
    }
    if (url === "/api/jobs" && method === "GET") {
      return jsonResponse(overrides.jobs ?? { jobs: [] });
    }
    if (url === "/api/analyze" && method === "POST") {
      return overrides.analyze ? overrides.analyze() : jsonResponse({ error: "not mocked" }, 500);
    }
    if (url === "/api/best-match" && method === "POST") {
      return overrides.bestMatch ? overrides.bestMatch() : jsonResponse({ error: "not mocked" }, 500);
    }

    throw new Error(`Unhandled fetch in test: ${method} ${url}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function waitForHydration() {
  await waitFor(() => {
    expect(screen.queryByText(/Loading current resume/i)).not.toBeInTheDocument();
  });
}

describe("CareerWorkspace", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows a validation error when analyzing without a resume", async () => {
    installFetchMock({ resume: { filename: null }, jobs: { jobs: [] } });
    render(<CareerWorkspace />);
    await waitForHydration();

    fireEvent.change(screen.getByLabelText("Question input"), {
      target: { value: "What skills am I missing?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    expect(
      await screen.findByText("Upload a resume before asking a question."),
    ).toBeInTheDocument();
  });

  it("disables job selector options for slots with no uploaded job description", async () => {
    installFetchMock({
      resume: { filename: "resume.pdf" },
      jobs: { jobs: [{ slot: 1, jobId: "job-1-id", filename: "job-1.pdf" }] },
    });
    render(<CareerWorkspace />);
    await waitForHydration();

    const select = screen.getByLabelText("Job selector") as HTMLSelectElement;
    const options = Array.from(select.options);

    expect(options.find((option) => option.value === "1")?.disabled).toBe(false);
    expect(options.find((option) => option.value === "2")?.disabled).toBe(true);
    expect(options.find((option) => option.value === "3")?.disabled).toBe(true);
    expect(options.find((option) => option.value === "4")?.disabled).toBe(true);
  });

  it("renders the analysis results after a successful analyze call, mapping job id to slot", async () => {
    installFetchMock({
      resume: { filename: "resume.pdf" },
      jobs: { jobs: [{ slot: 1, jobId: "job-1-id", filename: "job-1.pdf" }] },
      analyze: () =>
        jsonResponse({
          answer: "You are a strong fit.",
          strengths: ["TypeScript"],
          skillGaps: ["AWS"],
          experienceAlignment: "Good alignment.",
          interviewPreparation: ["Review the API project."],
          recommendations: ["Mention the ingestion pipeline."],
          sources: [
            {
              filename: "job-1.pdf",
              documentType: "job_description",
              jobId: "job-1-id",
              chunkIndex: 0,
              similarity: 0.87,
            },
          ],
        }),
    });

    render(<CareerWorkspace />);
    await waitForHydration();

    fireEvent.change(screen.getByLabelText("Job selector"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Question input"), {
      target: { value: "What skills am I missing?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    expect(await screen.findByText("You are a strong fit.")).toBeInTheDocument();
    expect(screen.getByText(/job: Job 1/)).toBeInTheDocument();
  });

  it("shows an error state when the analyze API call fails", async () => {
    installFetchMock({
      resume: { filename: "resume.pdf" },
      jobs: { jobs: [{ slot: 1, jobId: "job-1-id", filename: "job-1.pdf" }] },
      analyze: () => jsonResponse({ error: "Groq request failed" }, 400),
    });

    render(<CareerWorkspace />);
    await waitForHydration();

    fireEvent.change(screen.getByLabelText("Job selector"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Question input"), {
      target: { value: "What skills am I missing?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    expect(await screen.findByText("Groq request failed")).toBeInTheDocument();
  });

  it("shows a validation error when finding best match with no jobs uploaded", async () => {
    installFetchMock({ resume: { filename: "resume.pdf" }, jobs: { jobs: [] } });
    render(<CareerWorkspace />);
    await waitForHydration();

    fireEvent.click(screen.getByRole("button", { name: "Find Best Match" }));

    expect(
      await screen.findByText("Upload at least one job description before finding the best match."),
    ).toBeInTheDocument();
  });
});
