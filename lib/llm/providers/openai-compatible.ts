import { z } from "zod";
import {
  LLMConfigurationError,
  LLMResponseError,
  type LLMProvider,
  type StructuredGenerationInput,
  type StructuredGenerationResult,
} from "@/lib/llm/provider";

type OutputMode =
  | "json-schema"
  | "json-object"
  | "prompt-only";

type ProviderPayload = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

const COMPATIBILITY_STATUSES = new Set([
  400,
  404,
  415,
  422,
]);

function safeSchemaName(name: string): string {
  const normalized = name
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 64);

  return normalized || "structured_output";
}

function statusMessage(
  provider: string,
  status: number,
): string {
  if (status === 401 || status === 403) {
    return `${provider} rejected its configured credentials or permissions.`;
  }

  if (status === 402) {
    return `${provider} cannot run inference because the provider account requires billing or credits.`;
  }

  if (status === 408) {
    return `${provider} timed out while processing the request.`;
  }

  if (status === 429) {
    return `${provider} is rate-limited or out of quota.`;
  }

  if (status >= 500) {
    return `${provider} is temporarily unavailable (HTTP ${status}).`;
  }

  return `${provider} rejected the model request (HTTP ${status}).`;
}

async function parseProviderPayload(
  response: Response,
  provider: string,
): Promise<ProviderPayload> {
  const raw = await response.text();

  if (!raw.trim()) {
    throw new LLMResponseError(
      `${provider} returned an empty response.`,
    );
  }

  try {
    return JSON.parse(raw) as ProviderPayload;
  } catch {
    throw new LLMResponseError(
      `${provider} returned an unreadable response instead of JSON.`,
    );
  }
}

export class OpenAICompatibleProvider
  implements LLMProvider
{
  constructor(
    public readonly name: string,
    public readonly model: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly extraHeaders: Record<string, string> = {},
  ) {
    if (!baseUrl || !apiKey || !model) {
      throw new LLMConfigurationError(
        `${name} requires base URL, API key, and model.`,
      );
    }
  }

  private outputModes(): OutputMode[] {
    if (this.name === "groq") {
      return [
        "json-schema",
        "json-object",
      ];
    }

    return [
      "json-object",
      "prompt-only",
    ];
  }

  private responseFormat<T>(
    input: StructuredGenerationInput<T>,
    mode: OutputMode,
  ): unknown {
    if (mode === "prompt-only") {
      return undefined;
    }

    if (mode === "json-object") {
      return {
        type: "json_object",
      };
    }

    return {
      type: "json_schema",
      json_schema: {
        name: safeSchemaName(input.schemaName),
        strict: false,
        schema: z.toJSONSchema(input.schema),
      },
    };
  }

  private async request<T>(
    input: StructuredGenerationInput<T>,
    signal: AbortSignal,
    mode: OutputMode,
  ): Promise<Response> {
    const responseFormat =
      this.responseFormat(input, mode);

    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        {
          role: "system",
          content:
            `${input.system}\n\n` +
            `Return ONLY a JSON object matching the ${input.schemaName} contract. ` +
            `Do not wrap it in Markdown.\n${input.schemaHint}`,
        },
        {
          role: "user",
          content: input.user,
        },
      ],
    };

    /*
     * Gemini's OpenAI-compatible API does not require
     * Brick Tree's sampling controls. Omitting them
     * also keeps newer Gemini models compatible.
     */
    if (this.name !== "gemini") {
      body.temperature =
        input.temperature ?? 0.2;
    }

    if (responseFormat) {
      body.response_format =
        responseFormat;
    }

    return fetch(
      `${this.baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          ...this.extraHeaders,
        },
        body: JSON.stringify(body),
        signal,
      },
    );
  }

  async generateStructured<T>(
    input: StructuredGenerationInput<T>,
  ): Promise<StructuredGenerationResult<T>> {
    const started = Date.now();

    const timeoutSignal =
      AbortSignal.timeout(25_000);

    const signal = input.signal
      ? AbortSignal.any([
          input.signal,
          timeoutSignal,
        ])
      : timeoutSignal;

    const modes = this.outputModes();

    let response: Response | undefined;

    for (
      let index = 0;
      index < modes.length;
      index += 1
    ) {
      try {
        response = await this.request(
          input,
          signal,
          modes[index],
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === "TimeoutError"
        ) {
          throw new LLMResponseError(
            `${this.name} timed out.`,
          );
        }

        if (
          error instanceof Error &&
          error.name === "AbortError"
        ) {
          throw error;
        }

        throw new LLMResponseError(
          `${this.name} could not be reached.`,
        );
      }

      if (response.ok) {
        break;
      }

      const hasCompatibilityFallback =
        index < modes.length - 1 &&
        COMPATIBILITY_STATUSES.has(
          response.status,
        );

      if (!hasCompatibilityFallback) {
        break;
      }
    }

    if (!response?.ok) {
      throw new LLMResponseError(
        statusMessage(
          this.name,
          response?.status ?? 500,
        ),
      );
    }

    const payload =
      await parseProviderPayload(
        response,
        this.name,
      );

    const content =
      payload.choices?.[0]?.message?.content;

    if (!content) {
      throw new LLMResponseError(
        `${this.name} returned no structured content.`,
      );
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(content);
    } catch {
      throw new LLMResponseError(
        `${this.name} returned invalid structured JSON.`,
      );
    }

    const validated =
      input.schema.safeParse(parsed);

    if (!validated.success) {
      throw new LLMResponseError(
        `${this.name} output failed ${input.schemaName} validation: ${validated.error.issues
          .slice(0, 6)
          .map(
            (issue) =>
              `${issue.path.join(".")}: ${issue.message}`,
          )
          .join("; ")}`,
      );
    }

    return {
      data: validated.data,
      provider: this.name,
      model: this.model,
      latencyMs: Date.now() - started,
    };
  }
}