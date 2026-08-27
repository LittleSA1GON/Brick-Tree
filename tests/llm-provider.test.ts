import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { resetProviderCooldownsForTests, providerIsCoolingDown } from "@/lib/llm/cooldown";
import { LLMResponseError } from "@/lib/llm/provider";
import { OpenAICompatibleProvider } from "@/lib/llm/providers/openai-compatible";

const schema = z.object({ title: z.string(), note: z.string().optional() });
const input = {
  system: "Return structured output.",
  user: "Test",
  schema,
  schemaName: "ProviderTest",
  schemaHint: "JSON fields: title:string, note?:string",
  temperature: 0.2,
  maxOutputTokens: 1000,
};

function okResponse(
  content = JSON.stringify({ title: "ok" }),
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetProviderCooldownsForTests();
});

describe("OpenAI-compatible structured output", () => {
  it("uses one compact JSON-object request for Groq", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAICompatibleProvider(
      "groq",
      "openai/gpt-oss-120b",
      "https://api.groq.com/openai/v1",
      "test-key",
    );

    const result = await provider.generateStructured(input);
    expect(result.data.title).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.max_completion_tokens).toBe(1000);
    expect(body.max_tokens).toBeUndefined();
    expect(body.reasoning_effort).toBe("low");
  });

  it("does not spend a second Groq request after HTTP 400", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response("bad request", { status: 400 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAICompatibleProvider(
      "groq",
      "openai/gpt-oss-120b",
      "https://api.groq.com/openai/v1",
      "test-key",
    );

    await expect(provider.generateStructured(input)).rejects.toMatchObject({
      kind: "request_rejected",
      status: 400,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not spend an extra Gemini call on JSON Schema compatibility", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAICompatibleProvider(
      "gemini",
      "gemini-3.5-flash",
      "https://generativelanguage.googleapis.com/v1beta/openai",
      "test-key",
    );

    await provider.generateStructured(input);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body.temperature).toBeUndefined();
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.max_tokens).toBe(1000);
  });

  it("falls back to prompt-only JSON for compatible servers without response_format", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("unsupported response format", { status: 422 }))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAICompatibleProvider(
      "openai-compatible",
      "local-model",
      "http://localhost:11434/v1",
      "local",
    );

    await provider.generateStructured(input);
    const first = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const second = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(first.response_format).toEqual({ type: "json_object" });
    expect(second.response_format).toBeUndefined();
  });

  it("stops immediately on 429 and preserves retry-after without exposing the body", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response("secret upstream body that must never reach the browser", {
        status: 429,
        headers: { "retry-after": "12" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAICompatibleProvider(
      "groq",
      "openai/gpt-oss-120b",
      "https://api.groq.com/openai/v1",
      "test-key",
    );

    let failure: unknown;
    try {
      await provider.generateStructured(input);
    } catch (error) {
      failure = error;
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(failure).toBeInstanceOf(LLMResponseError);
    const error = failure as LLMResponseError;
    expect(error.kind).toBe("rate_limit");
    expect(error.retryAfterMs).toBe(12_000);
    expect(error.message).toContain("rate-limited");
    expect(error.message).not.toContain("secret upstream body");
  });

  it("uses Groq remaining-token headers to pause new Groq calls before a 429", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      okResponse(JSON.stringify({ title: "ok" }), {
        "x-ratelimit-remaining-tokens": "1200",
        "x-ratelimit-reset-tokens": "8s",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAICompatibleProvider(
      "groq",
      "openai/gpt-oss-120b",
      "https://api.groq.com/openai/v1",
      "test-key",
    );

    await provider.generateStructured(input);
    expect(providerIsCoolingDown("groq")).toBe(true);
  });
});
