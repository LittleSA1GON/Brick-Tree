import type { ZodType } from "zod";

export type StructuredGenerationInput<T> = {
  system: string;
  user: string;
  schema: ZodType<T>;
  schemaName: string;
  schemaHint: string;
  temperature?: number;
  maxOutputTokens?: number;
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

export type LLMFailureKind =
  | "authentication"
  | "billing"
  | "rate_limit"
  | "timeout"
  | "provider_unavailable"
  | "request_rejected"
  | "invalid_response";

export type LLMResponseErrorOptions = {
  kind?: LLMFailureKind;
  status?: number;
  retryAfterMs?: number;
};

export class LLMConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMConfigurationError";
  }
}

export class LLMResponseError extends Error {
  readonly kind: LLMFailureKind;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(message: string, options: LLMResponseErrorOptions = {}) {
    super(message);
    this.name = "LLMResponseError";
    this.kind = options.kind ?? "invalid_response";
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }

  get allowsSameProviderRepair(): boolean {
    return this.kind === "invalid_response";
  }

  get shouldCooldownProvider(): boolean {
    return this.kind === "rate_limit" || this.kind === "provider_unavailable" || this.kind === "timeout";
  }
}
