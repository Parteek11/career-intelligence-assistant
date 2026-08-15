import { NextResponse } from "next/server";
import { listJobs } from "@/db/repositories/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reports whichever job slots (1-4) currently have an uploaded job, so
 * the UI can reflect real server state after a page refresh instead of
 * only session actions. */
export async function GET() {
  const jobs = await listJobs();

  return NextResponse.json({
    jobs: jobs.map((job) => ({
      slot: job.slot,
      jobId: job.id,
      filename: job.original_filename,
    })),
  });
}
