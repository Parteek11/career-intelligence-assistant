// Development script: inserts a few sample chunks with real embeddings,
// then runs a pgvector cosine-distance search against them.
// Requires PostgreSQL running and migrated: docker compose up -d && npm run db:migrate
// Run with: node scripts/vector-search-demo.mjs

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "@huggingface/transformers";
import { Pool } from "pg";

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
const DEMO_MARKER = "vector-search-demo";

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

const sampleJobs = [
  {
    slot: 1,
    filename: `${DEMO_MARKER}-job-1.txt`,
    content:
      "Senior Backend Engineer. Design APIs and data models with TypeScript and PostgreSQL. Own document processing pipelines.",
  },
  {
    slot: 2,
    filename: `${DEMO_MARKER}-job-2.txt`,
    content:
      "Marketing Manager. Plan campaigns, manage brand partnerships, and analyze customer engagement metrics.",
  },
];

async function resetDemoData(pool) {
  await pool.query(
    `DELETE FROM jobs WHERE original_filename LIKE $1`,
    [`${DEMO_MARKER}-%`],
  );
}

async function insertSampleChunks(pool, extractor) {
  const insertedJobs = [];

  for (const job of sampleJobs) {
    const jobRow = await pool.query(
      `INSERT INTO jobs (slot, original_filename, title)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [job.slot, job.filename, job.content.split(".")[0]],
    );
    const jobId = jobRow.rows[0].id;

    const documentRow = await pool.query(
      `INSERT INTO documents (document_type, job_id, original_filename, mime_type, file_size)
       VALUES ('job_description', $1, $2, 'text/plain', $3)
       RETURNING id`,
      [jobId, job.filename, job.content.length],
    );
    const documentId = documentRow.rows[0].id;

    const output = await extractor([job.content], { pooling: "mean", normalize: true });
    const dims = output.dims.at(-1);
    const embedding = Array.from(output.data).slice(0, dims);

    await pool.query(
      `INSERT INTO document_chunks (document_id, chunk_index, content, embedding, metadata)
       VALUES ($1, 0, $2, $3::vector, $4::jsonb)`,
      [documentId, job.content, toVectorLiteral(embedding), JSON.stringify({ source: job.filename })],
    );

    insertedJobs.push({ slot: job.slot, jobId, documentId });
  }

  return insertedJobs;
}

async function searchDemo(pool, extractor, queryText, topK) {
  const output = await extractor([queryText], { pooling: "mean", normalize: true });
  const dims = output.dims.at(-1);
  const queryEmbedding = Array.from(output.data).slice(0, dims);

  const result = await pool.query(
    `SELECT dc.content, dc.metadata, j.slot AS job_slot, j.title AS job_title,
            dc.embedding <=> $1::vector AS distance
       FROM document_chunks dc
       JOIN jobs j ON j.id = dc.job_id
      WHERE dc.embedding IS NOT NULL
        AND j.original_filename LIKE $2
      ORDER BY dc.embedding <=> $1::vector
      LIMIT $3`,
    [toVectorLiteral(queryEmbedding), `${DEMO_MARKER}-%`, topK],
  );

  return result.rows;
}

async function main() {
  loadProjectEnv();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env first.");
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    console.log(`Loading ${MODEL_NAME}...`);
    const extractor = await pipeline("feature-extraction", MODEL_NAME);

    console.log("Resetting previous demo rows...");
    await resetDemoData(pool);

    console.log("Inserting sample job chunks with real embeddings...");
    await insertSampleChunks(pool, extractor);

    const query = "Looking for a candidate with TypeScript and PostgreSQL backend experience";
    console.log(`\nQuery: "${query}"\n`);

    const results = await searchDemo(pool, extractor, query, 2);

    results.forEach((row, index) => {
      const similarity = 1 - row.distance;
      console.log(
        `#${index + 1} job_slot=${row.job_slot} title="${row.job_title}" ` +
          `distance=${row.distance.toFixed(4)} similarity=${similarity.toFixed(4)}`,
      );
      console.log(`   content: ${row.content}`);
      console.log(`   metadata: ${JSON.stringify(row.metadata)}`);
    });

    // Demo rows use real job slots (1-4), which are a scarce, unique resource
    // shared with the rest of the local database. Clean them up so this
    // script can be re-run freely without permanently occupying a slot.
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
