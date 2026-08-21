import { NextResponse } from "next/server";
import { getResume } from "@/db/queries";
import { deleteResume, uploadResume } from "@/services/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const summary = await uploadResume({
      buffer: Buffer.from(await file.arrayBuffer()),
      filename: file.name,
      mimeType: file.type || undefined,
    });
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Resume upload failed" },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  await deleteResume();
  return NextResponse.json({ ok: true });
}
