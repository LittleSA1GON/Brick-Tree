import { parseLearningDocument } from "@/lib/documents/parser";
import { assertSameOrigin } from "@/lib/utils/request";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_FILE_SIZE = 4 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ ok: false, error: "A file is required." }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return Response.json({ ok: false, error: "Files are limited to 4 MB for server-side Vercel-compatible parsing." }, { status: 413 });
    }

    const result = await parseLearningDocument(file);
    return Response.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Document processing failed.";
    return Response.json(
      { ok: false, error: message === "invalid_origin" ? "Cross-origin document uploads are not allowed." : message },
      { status: message === "invalid_origin" ? 403 : 400 },
    );
  }
}
