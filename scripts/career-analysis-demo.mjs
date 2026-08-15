// Development script: inserts a sample resume + job chunk with real
// embeddings, retrieves evidence, sends a grounded prompt to Groq, and
// prints the resulting structured career analysis.
// Requires PostgreSQL running/migrated and GROQ_API_KEY set:
//   docker compose up -d && npm run db:migrate
// Run with: node scripts/career-analysis-demo.mjs

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "@huggingface/transformers";
import { Pool } from "pg";

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
const DEMO_MARKER = "career-analysis-demo";
const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";
const QUESTION = "What skills am I missing for this job?";

function loadProjectEnv() {
  const envPath = join(process.cwd(), ".env");
  if (!existsSync(envPath)) {
    return;
  }

  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1);
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function toVectorLiteral(embedding) {
  return `[${embedding.join(",")}]`;
}

const resumeContent =
  "Built and operated TypeScript APIs with PostgreSQL, including document ingestion and background jobs. Mentored two junior engineers on testing and code review.";

const jobContent =
  "Senior Backend Engineer. Requires 3+ years of TypeScript and PostgreSQL experience, ownership of production infrastructure on AWS, and experience mentoring engineers.";

async function resetDemoData(pool) {
  await pool.query(`DELETE FROM jobs WHERE original_filename LIKE $1`, [
    `${DEMO_MARKER}-%`,
  ]);
  await pool.query(`DELETE FROM resumes WHERE original_filename LIKE $1`, [
    `${DEMO_MARKER}-%`,
  ]);
}

async function embed(extractor, text) {
  const output = await extractor([text], { pooling: "mean", normalize: true });
  const dims = output.dims.at(-1);
  return Array.from(output.data).slice(0, dims);
}

async function insertSampleData(pool, extractor) {
  const resumeFilename = `${DEMO_MARKER}-resume.txt`;
  const resume = await pool.query(
    `INSERT INTO resumes (original_filename) VALUES ($1) RETURNING id`,
    [resumeFilename],
  );
  const resumeDocument = await pool.query(
    `INSERT INTO documents (document_type, resume_id, original_filename, mime_type, file_size)
     VALUES ('resume', $1, $2, 'text/plain', $3)
     RETURNING id`,
    [resume.rows[0].id, resumeFilename, resumeContent.length],
  );
  const resumeEmbedding = await embed(extractor, resumeContent);
  await pool.query(
    `INSERT INTO document_chunks (document_id, chunk_index, content, embedding, metadata)
     VALUES ($1, 0, $2, $3::vector, $4::jsonb)`,
    [
      resumeDocument.rows[0].id,
      resumeContent,
      toVectorLiteral(resumeEmbedding),
      JSON.stringify({ original_filename: resumeFilename }),
    ],
  );

  const jobFilename = `${DEMO_MARKER}-job-1.txt`;
  const job = await pool.query(
    `INSERT INTO jobs (slot, original_filename, title) VALUES (1, $1, 'Senior Backend Engineer') RETURNING id`,
    [jobFilename],
  );
  const jobDocument = await pool.query(
    `INSERT INTO documents (document_type, job_id, original_filename, mime_type, file_size)
     VALUES ('job_description', $1, $2, 'text/plain', $3)
     RETURNING id`,
    [job.rows[0].id, jobFilename, jobContent.length],
  );
  const jobEmbedding = await embed(extractor, jobContent);
  await pool.query(
    `INSERT INTO document_chunks (document_id, chunk_index, content, embedding, metadata)
     VALUES ($1, 0, $2, $3::vector, $4::jsonb)`,
    [
      jobDocument.rows[0].id,
      jobContent,
      toVectorLiteral(jobEmbedding),
      JSON.stringify({ original_filename: jobFilename }),
    ],
  );

  return { jobId: job.rows[0].id };
}

/** Mirrors src/services/retrieval.ts: resume chunks + the selected job's
 * chunks, each ranked by pgvector cosine distance, merged in JS. */
async function retrieveEvidence(pool, queryEmbedding, jobId, topK) {
  const vectorLiteral = toVectorLiteral(queryEmbedding);

  const resumeMatches = await pool.query(
    `SELECT document_type, job_id, chunk_index, content, metadata,
            embedding <=> $1::vector AS distance
       FROM document_chunks
      WHERE embedding IS NOT NULL AND document_type = 'resume'
      ORDER BY embedding <=> $1::vector
      LIMIT $2`,
    [vectorLiteral, topK],
  );

  const jobMatches = await pool.query(
    `SELECT document_type, job_id, chunk_index, content, metadata,
            embedding <=> $1::vector AS distance
       FROM document_chunks
      WHERE embedding IS NOT NULL AND job_id = $2
      ORDER BY embedding <=> $1::vector
      LIMIT $3`,
    [vectorLiteral, jobId, topK],
  );

  return [...resumeMatches.rows, ...jobMatches.rows]
    .sort((a, b) => a.distance - b.distance)
    .slice(0, topK)
    .map((row) => ({
      content: row.content,
      similarity: 1 - row.distance,
      documentType: row.document_type,
      jobId: row.job_id,
      filename: row.metadata?.original_filename ?? null,
      chunkIndex: row.chunk_index,
    }));
}

/** Mirrors src/generation/prompt.ts. Kept identical on purpose so the demo
 * reflects the real grounding rules, not a simplified stand-in. */
function buildGroundedPrompt(question, evidence) {
  const system = [
    "You are the Career Intelligence Assistant. You compare a candidate's resume against job description evidence to answer a career-fit question.",
    "",
    "You must follow these rules strictly:",
    "1. Use ONLY the retrieved evidence provided in the user message. Do not use outside knowledge about the candidate, the company, or the role.",
    "2. Never invent, assume, or embellish the candidate's experience, skills, or achievements beyond what the resume evidence states.",
    "3. Clearly distinguish candidate evidence (document_type=resume) from job requirements (document_type=job_description) in your reasoning. Do not present a job requirement as something the candidate has done.",
    "4. If the retrieved evidence does not support a claim, say \"insufficient evidence\" for that specific point instead of guessing.",
    "5. Do not assume a skill is definitely absent just because it was not retrieved. Only list something as a skill gap when the job evidence requires it AND the resume evidence does not show it. If the evidence is too thin to tell, say so explicitly rather than concluding the candidate lacks it.",
    "6. Respond with a single strict JSON object and nothing else — no markdown code fences, no commentary before or after — matching exactly this shape:",
    `{
  "answer": string,
  "strengths": string[],
  "skillGaps": string[],
  "experienceAlignment": string,
  "interviewPreparation": string[],
  "recommendations": string[]
}`,
  ].join("\n");

  const evidenceBlock = evidence
    .map(
      (item, index) =>
        `[${index + 1}] document_type=${item.documentType} job_id=${item.jobId ?? "null"} ` +
        `filename=${item.filename ?? "unknown"} chunk_index=${item.chunkIndex} ` +
        `similarity=${item.similarity.toFixed(4)}\ncontent: ${item.content}`,
    )
    .join("\n\n");

  const user = [`Question: ${question}`, "", "Retrieved evidence (use only this):", evidenceBlock].join(
    "\n",
  );

  return { system, user };
}

async function callGroq(apiKey, model, prompt) {
  const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Groq request failed with status ${response.status}: ${body.slice(0, 500)}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Groq response did not include message content");
  }

  return content;
}

async function main() {
  loadProjectEnv();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env first.");
  }

  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    console.error(
      "GROQ_API_KEY is not set. Add it to .env before running this script (see .env.example).",
    );
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    console.log(`Loading ${MODEL_NAME}...`);
    const extractor = await pipeline("feature-extraction", MODEL_NAME);

    console.log("Resetting previous demo rows...");
    await resetDemoData(pool);

    console.log("Inserting sample resume + job chunks with real embeddings...");
    const { jobId } = await insertSampleData(pool, extractor);

    console.log(`\nQuestion: "${QUESTION}"\n`);
    const queryEmbedding = await embed(extractor, QUESTION);
    const evidence = await retrieveEvidence(pool, queryEmbedding, jobId, 5);

    const prompt = buildGroundedPrompt(QUESTION, evidence);
    const model = process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL;

    console.log(`Calling Groq (${model})...\n`);
    const raw = await callGroq(groqApiKey, model, prompt);
    const analysis = JSON.parse(raw);

    console.log("Answer:");
    console.log(`  ${analysis.answer}\n`);

    console.log("Skill gaps:");
    for (const gap of analysis.skillGaps ?? []) {
      console.log(`  - ${gap}`);
    }

    console.log("\nSources:");
    evidence.forEach((item, index) => {
      console.log(
        `  [${index + 1}] documentType=${item.documentType} jobId=${item.jobId ?? "null"} ` +
          `filename=${item.filename} chunkIndex=${item.chunkIndex} similarity=${item.similarity.toFixed(4)}`,
      );
    });

    console.log("\nCleaning up demo rows...");
    await resetDemoData(pool);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
