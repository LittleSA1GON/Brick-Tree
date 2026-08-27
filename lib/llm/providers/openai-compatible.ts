import type { ProviderName } from "@/lib/config/env";
import {
  markProviderHealthy,
  observeProviderRateLimitHeaders,
} from "@/lib/llm/cooldown";
import {
  LLMConfigurationError,
  LLMResponseError,
  type LLMFailureKind,
  type LLMProvider,
  type StructuredGenerationInput,
  type StructuredGenerationResult,
} from "@/lib/llm/provider";

type OutputMode = "json-object" | "prompt-only";

type ProviderPayload = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

const COMPATIBILITY_STATUSES = new Set([400, 404, 415, 422]);

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }

  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    return Math.max(1000, date - Date.now());
  }

  return undefined;
}

function failureKind(status: number): LLMFailureKind {
  if (status === 401 || status === 403) return "authentication";
  if (status === 402) return "billing";
  if (status === 408) return "timeout";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "provider_unavailable";
  return "request_rejected";
}

function statusMessage(provider: string, status: number): string {
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
  if (status === 400) {
    return `${provider} rejected the structured generation request (HTTP 400).`;
  }
  return `${provider} rejected the model request (HTTP ${status}).`;
}

async function providerPayload(response: Response, provider: string): Promise<ProviderPayload> {
  const raw = await response.text();
  if (!raw.trim()) {
    throw new LLMResponseError(`${provider} returned an empty response.`, {
      kind: "invalid_response",
    });
  }

  try {
    return JSON.parse(raw) as ProviderPayload;
  } catch {
    throw new LLMResponseError(`${provider} returned an unreadable response instead of JSON.`, {
      kind: "invalid_response",
    });
  }
}

export class OpenAICompatibleProvider implements LLMProvider {
  constructor(
    public readonly name: string,
    public readonly model: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly extraHeaders: Record<string, string> = {},
  ) {
    if (!baseUrl || !apiKey || !model) {
      throw new LLMConfigurationError(`${name} requires base URL, API key, and model.`);
    }
  }

  private providerName(): ProviderName | undefined {
    if (
      this.name === "groq" ||
      this.name === "gemini" ||
      this.name === "cloudflare" ||
      this.name === "openrouter" ||
      this.name === "openai-compatible"
    ) {
      return this.name;
    }
    return undefined;
  }

  /**
   * Groq and Gemini both support JSON-object output on the configured endpoints,
   * so each gets exactly one request per runtime attempt. Generic/router endpoints
   * keep a prompt-only compatibility fallback because support varies by model.
   */
  private outputModes(): OutputMode[] {
    if (this.name === "groq" || this.name === "gemini") {
      return ["json-object"];
    }
    return ["json-object", "prompt-only"];
  }

  private async request<T>(
    input: StructuredGenerationInput<T>,
    signal: AbortSignal,
    mode: OutputMode,
  ): Promise<Response> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        {
          role: "system",
          content:
            `${input.system}\n\n` +
            `Return ONLY one valid JSON object matching the ${input.schemaName} contract. ` +
            `Do not use Markdown, code fences, or commentary outside the JSON.\n${input.schemaHint}`,
        },
        { role: "user", content: input.user },
      ],
    };

    if (this.name === "groq") {
      body.max_completion_tokens = input.maxOutputTokens ?? 1000;
      if (this.model === "openai/gpt-oss-120b" || this.model === "openai/gpt-oss-20b") {
        body.reasoning_effort = "low";
      }
    } else {
      body.max_tokens = input.maxOutputTokens ?? 1000;
    }

    // Gemini model generations have changed sampling-parameter support over time;
    // omitting temperature keeps its OpenAI-compatible path conservative.
    if (this.name !== "gemini") {
      body.temperature = input.temperature ?? 0.2;
    }

    if (mode === "json-object") {
      body.response_format = { type: "json_object" };
    }

    return fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...this.extraHeaders,
      },
      body: JSON.stringify(body),
      signal,
    });
  }

  async generateStructured<T>(
    input: StructuredGenerationInput<T>,
  ): Promise<StructuredGenerationResult<T>> {
    const started = Date.now();
    const timeoutSignal = AbortSignal.timeout(25_000);
    const signal = input.signal
      ? AbortSignal.any([input.signal, timeoutSignal])
      : timeoutSignal;
    const modes = this.outputModes();
    const providerName = this.providerName();

    let response: Response | undefined;

    try {
      for (let index = 0; index < modes.length; index += 1) {
        response = await this.request(input, signal, modes[index]);

        if (providerName) {
          observeProviderRateLimitHeaders(providerName, response.headers);
        }

        if (response.ok) break;

        const canTryCompatibilityMode =
          index < modes.length - 1 && COMPATIBILITY_STATUSES.has(response.status);
        if (!canTryCompatibilityMode) break;
      }
    } catch (error) {
      const isAbort =
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError");

      if (isAbort) {
        throw new LLMResponseError(`${this.name} timed out.`, {
          kind: "timeout",
          status: 408,
        });
      }

      throw new LLMResponseError(`${this.name} could not be reached.`, {
        kind: "provider_unavailable",
      });
    }

    if (!response?.ok) {
      const status = response?.status ?? 503;
      throw new LLMResponseError(statusMessage(this.name, status), {
        kind: failureKind(status),
        status,
        retryAfterMs: response ? retryAfterMs(response) : undefined,
      });
    }

    const payload = await providerPayload(response, this.name);
    const content = payload.choices?.[0]?.message?.content;

    if (!content) {
      throw new LLMResponseError(`${this.name} returned no structured content.`, {
        kind: "invalid_response",
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new LLMResponseError(`${this.name} returned invalid structured JSON.`, {
        kind: "invalid_response",
      });
    }

    const validated = input.schema.safeParse(parsed);
    if (!validated.success) {
      throw new LLMResponseError(
        `${this.name} output failed ${input.schemaName} validation: ${validated.error.issues
          .slice(0, 6)
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
        { kind: "invalid_response" },
      );
    }

    if (providerName) markProviderHealthy(providerName);

    return {
      data: validated.data,
      provider: this.name,
      model: this.model,
      latencyMs: Date.now() - started,
    };
  }
}
