import { NextResponse } from "next/server";
import { deleteJobDescription, uploadJobDescription } from "@/services/documents";
import { isJobSlot, type JobSlot } from "@/types/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slot: string }> };

async function parseSlot(params: RouteContext["params"]): Promise<JobSlot | null> {
  const { slot } = await params;
  const parsed = Number(slot);
  return isJobSlot(parsed) ? parsed : null;
}

export async function POST(request: Request, { params }: RouteContext) {
  const slot = await parseSlot(params);
  if (slot === null) {
    return NextResponse.json({ error: "slot must be 1, 2, 3, or 4" }, { status: 400 });
  }

  const file = (await request.formData()).get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A file field is required" }, { status: 400 });
  }

  try {
    const summary = await uploadJobDescription(slot, {
      buffer: Buffer.from(await file.arrayBuffer()),
      filename: file.name,
      mimeType: file.type || undefined,
    });
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Job upload failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const slot = await parseSlot(params);
  if (slot === null) {
    return NextResponse.json({ error: "slot must be 1, 2, 3, or 4" }, { status: 400 });
  }

  await deleteJobDescription(slot);
  return NextResponse.json({ ok: true });
}
