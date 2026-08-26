import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OpenAICompatibleProvider } from "@/lib/llm/providers/openai-compatible";

const schema = z.object({ title: z.string(), note: z.string().optional() });
const input = {
  system: "Return structured output.",
  user: "Test",
  schema,
  schemaName: "ProviderTest",
  schemaHint: "JSON fields: title:string, note?:string",
  temperature: 0.2,
};

function okResponse(content = JSON.stringify({ title: "ok" })) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAI-compatible structured output", () => {
  it("asks Groq for JSON Schema first and falls back to JSON Object mode", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("schema rejected", { status: 400 }))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAICompatibleProvider(
      "groq",
      "openai/gpt-oss-120b",
      "https://api.groq.com/openai/v1",
      "test-key",
    );

    const result = await provider.generateStructured(input);
    expect(result.data.title).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const first = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const second = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(first.response_format.type).toBe("json_schema");
    expect(first.response_format.json_schema.strict).toBe(false);
    expect(second.response_format).toEqual({ type: "json_object" });
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

  it("does not send sampling controls to Gemini", async () => {
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
    expect(body.temperature).toBeUndefined();
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("sanitizes upstream error bodies", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response("secret upstream body that must never reach the browser", { status: 429 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAICompatibleProvider(
      "groq",
      "openai/gpt-oss-120b",
      "https://api.groq.com/openai/v1",
      "test-key",
    );

    let message = "";
    try {
      await provider.generateStructured(input);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("rate-limited");
    expect(message).not.toContain("secret upstream body");
  });
});
