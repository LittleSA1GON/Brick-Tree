import {
  LLMConfigurationError,
  LLMResponseError,
  type LLMProvider,
  type StructuredGenerationInput,
  type StructuredGenerationResult,
} from "@/lib/llm/provider";

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

  private async request<T>(
    input: StructuredGenerationInput<T>,
    signal: AbortSignal,
    useJsonMode: boolean,
  ): Promise<Response> {
    return fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...this.extraHeaders,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: input.temperature ?? 0.2,
        ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
        messages: [
          {
            role: "system",
            content: `${input.system}\n\nReturn ONLY a JSON object matching the ${input.schemaName} contract. Do not wrap it in Markdown.\n${input.schemaHint}`,
          },
          { role: "user", content: input.user },
        ],
      }),
      signal,
    });
  }

  async generateStructured<T>(input: StructuredGenerationInput<T>): Promise<StructuredGenerationResult<T>> {
    const started = Date.now();
    const timeoutSignal = AbortSignal.timeout(25_000);
    const signal = input.signal ? AbortSignal.any([input.signal, timeoutSignal]) : timeoutSignal;

    let response = await this.request(input, signal, true);
    if (!response.ok && this.name === "openai-compatible" && [400, 404, 422].includes(response.status)) {
      // Some local OpenAI-compatible servers do not implement response_format.
      response = await this.request(input, signal, false);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new LLMResponseError(`${this.name} returned ${response.status}: ${text.slice(0, 500)}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new LLMResponseError(`${this.name} returned no structured content.`);

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new LLMResponseError(`${this.name} returned invalid JSON.`);
    }

    const validated = input.schema.safeParse(parsed);
    if (!validated.success) {
      throw new LLMResponseError(
        `${this.name} output failed ${input.schemaName} validation: ${validated.error.issues
          .slice(0, 6)
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
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
