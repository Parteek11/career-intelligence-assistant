import { NextResponse } from "next/server";
import { deleteJobDescription, uploadJobDescription } from "@/services/document-management";
import { isJobSlot, type JobSlot } from "@/types/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slot: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const slot = await parseSlot(params);
  if (slot === null) {
    return invalidSlotResponse();
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A file field is required" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const summary = await uploadJobDescription(slot, {
      buffer,
      filename: file.name,
      mimeType: file.type || undefined,
    });

    return NextResponse.json(summary, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: toMessage(error) }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const slot = await parseSlot(params);
  if (slot === null) {
    return invalidSlotResponse();
  }

  await deleteJobDescription(slot);
  return NextResponse.json({ ok: true });
}

async function parseSlot(params: RouteContext["params"]): Promise<JobSlot | null> {
  const { slot: slotParam } = await params;
  const parsed = Number(slotParam);
  return isJobSlot(parsed) ? parsed : null;
}

function invalidSlotResponse() {
  return NextResponse.json({ error: "slot must be 1, 2, 3, or 4" }, { status: 400 });
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
