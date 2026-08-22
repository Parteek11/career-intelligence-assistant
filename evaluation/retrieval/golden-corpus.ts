import type { JobSlot } from "@/types/domain";
import type { LogicalJobId } from "./types";

/**
 * Fixed golden-dataset corpus: one resume and four job descriptions,
 * written specifically to make the golden questions' expected concepts
 * and job-id restrictions unambiguous. This is separate from — and
 * overwrites — whatever resume/jobs are currently uploaded through the
 * app UI; see README "Evaluation" for why.
 *
 * Design of the four jobs (deliberate overlap + contrast):
 * - job_1 backend — strong overlap with the resume (TS, Node, Postgres, mentoring)
 * - job_2 frontend — partial overlap (React + TypeScript only)
 * - job_3 cloud — intentional *non*-match (AWS / Terraform / K8s are called out as absent)
 * - job_4 AI/RAG — strong overlap (LangChain, pgvector, embeddings)
 *
 * Questions in `golden-questions.json` rely on these contrasts, e.g.
 * "cloud gaps" should retrieve job_3 + the resume's "No production
 * experience with AWS…" line.
 */
export const GOLDEN_RESUME = {
  filename: "golden-resume.txt",
  content: [
    "Software engineer with 4 years of experience building backend services in TypeScript and Node.js, with PostgreSQL as the primary database.",
    "Designed and maintained REST APIs, background job pipelines, and a document ingestion system using LangChain and pgvector for semantic search and retrieval-augmented generation.",
    "Built a small React and TypeScript admin dashboard used internally by the operations team.",
    "Mentored two junior engineers on code review, testing practices, and production debugging.",
    "No production experience with AWS, Terraform, or Kubernetes; all deployments so far have been to a single managed server.",
  ].join(" "),
};

export const GOLDEN_JOBS: Record<
  LogicalJobId,
  { slot: JobSlot; filename: string; content: string }
> = {
  job_1: {
    slot: 1,
    filename: "golden-job-1-backend.txt",
    content:
      "Senior Backend Engineer. Design and own REST APIs and data models using TypeScript, Node.js, and PostgreSQL. Build reliable background job pipelines and document processing systems. Mentor junior engineers on code quality, testing, and production debugging. 4+ years of backend experience required.",
  },
  job_2: {
    slot: 2,
    filename: "golden-job-2-frontend.txt",
    content:
      "Frontend Engineer. Build accessible, responsive user interfaces using React and TypeScript. Own our internal design system and component library. Collaborate closely with backend engineers on API contracts. Experience with accessibility and design systems preferred.",
  },
  job_3: {
    slot: 3,
    filename: "golden-job-3-cloud.txt",
    content:
      "Cloud Infrastructure Engineer. Design and operate our AWS infrastructure using Terraform and Kubernetes. Own CI/CD pipelines and production monitoring. Strong hands-on experience with AWS, Terraform, and container orchestration required.",
  },
  job_4: {
    slot: 4,
    filename: "golden-job-4-ai-rag.txt",
    content:
      "AI and RAG Engineer. Build retrieval-augmented generation systems using LangChain, embeddings, and a vector database such as pgvector. Design chunking and retrieval strategies for large document sets. Experience with LLM prompting and evaluation is a plus.",
  },
};
