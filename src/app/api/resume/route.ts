import { NextResponse } from "next/server";
import { getResume } from "@/db/repositories/resumes";
import { deleteResume, uploadResume } from "@/services/document-management";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reports whatever resume currently exists, so the UI can reflect real
 * server state after a page refresh instead of only session actions. */
export async function GET() {
  const resume = await getResume();
  return NextResponse.json({ filename: resume?.original_filename ?? null });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A file field is required" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const summary = await uploadResume({
      buffer,
      filename: file.name,
      mimeType: file.type || undefined,
    });

    return NextResponse.json(summary, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: toMessage(error) }, { status: 500 });
  }
}

export async function DELETE() {
  await deleteResume();
  return NextResponse.json({ ok: true });
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
