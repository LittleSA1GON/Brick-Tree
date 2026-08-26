import type { ZodType } from "zod";
import type { TraceCollector } from "@/lib/observability/trace";
import type { ExtractedDocument } from "@/lib/schemas/documents";

export type ToolContext = {
  trace: TraceCollector;
  agentName: string;
  signal?: AbortSignal;
  documents?: ExtractedDocument[];
};

export interface AgentTool<TInput = unknown, TOutput = unknown> {
  name: string;
  inputSchema: ZodType<TInput>;
  timeoutMs?: number;
  execute(input: TInput, context: ToolContext): Promise<TOutput>;
}
