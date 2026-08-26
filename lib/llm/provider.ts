import type { ZodType } from "zod";

export type StructuredGenerationInput<T> = {
  system: string;
  user: string;
  schema: ZodType<T>;
  schemaName: string;
  schemaHint: string;
  temperature?: number;
  signal?: AbortSignal;
};

export type StructuredGenerationResult<T> = {
  data: T;
  provider: string;
  model: string;
  latencyMs: number;
};

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  generateStructured<T>(input: StructuredGenerationInput<T>): Promise<StructuredGenerationResult<T>>;
}

export class LLMConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMConfigurationError";
  }
}

export class LLMResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMResponseError";
  }
}
