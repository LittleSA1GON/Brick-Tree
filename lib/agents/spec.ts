import type { ZodType } from "zod";

export type AgentSpec<TInput = unknown, TOutput = unknown> = {
  name: string;
  description: string;
  instructions: string;
  allowedTools: string[];
  allowedHandoffs: string[];
  maxSteps: number;
  outputSchema: ZodType<TOutput>;
  schemaName: string;
  schemaHint: string;
  buildUserPrompt(input: TInput): string;
};
