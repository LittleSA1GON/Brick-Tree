import { z } from "zod";
import type { AgentTool } from "@/lib/tools/base";
import { getEnv } from "@/lib/config/env";
import { RetrievedChunkSchema, type RetrievedChunk } from "@/lib/schemas/documents";

const InputSchema = z.object({
  query: z.string().min(1).max(500),
  scope: z.string().max(200).optional(),
  topK: z.number().int().min(1).max(10).default(5),
});

export const knowledgeSearchTool: AgentTool<z.infer<typeof InputSchema>, RetrievedChunk[]> = {
  name: "search_knowledge_base",
  inputSchema: InputSchema,
  async execute(input, context) {
    const baseUrl = getEnv().LOCAL_RAG_BASE_URL;
    if (!baseUrl) return [];
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: context.signal,
    });
    if (!response.ok) throw new Error(`Knowledge retrieval returned ${response.status}.`);
    const payload = (await response.json()) as unknown;
    const chunks = Array.isArray(payload)
      ? payload
      : payload && typeof payload === "object" && "chunks" in payload
        ? (payload as { chunks?: unknown }).chunks ?? []
        : [];
    return z.array(RetrievedChunkSchema).max(10).parse(chunks);
  },
};
