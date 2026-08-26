import { z } from "zod";
import type { AgentTool } from "@/lib/tools/base";
import { searchExtractedDocuments } from "@/lib/documents/retrieval";

export const uploadedDocumentSearchTool: AgentTool<
  { query: string; topK?: number },
  ReturnType<typeof searchExtractedDocuments>
> = {
  name: "search_uploaded_documents",
  timeoutMs: 3_000,
  inputSchema: z.object({
    query: z.string().trim().min(2).max(400),
    topK: z.number().int().min(1).max(10).optional(),
  }),
  async execute(input, context) {
    return searchExtractedDocuments(context.documents ?? [], input.query, input.topK ?? 5);
  },
};
