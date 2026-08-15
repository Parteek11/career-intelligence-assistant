import { describe, expect, it } from "vitest";
import { ingestDocument } from "@/rag/ingest";
import { IngestionError } from "@/rag/errors";

describe("PDF loader integration", () => {
  it("returns a safe error for invalid PDF bytes", async () => {
    await expect(
      ingestDocument({
        file: {
          buffer: Buffer.from("this is not a pdf"),
          filename: "resume.pdf",
          mimeType: "application/pdf",
        },
        metadata: {
          documentId: "resume-pdf-1",
          documentType: "resume",
          jobId: null,
          originalFilename: "resume.pdf",
        },
      }),
    ).rejects.toBeInstanceOf(IngestionError);
  });
});
