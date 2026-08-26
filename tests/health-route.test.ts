import { afterEach, describe, expect, it } from "vitest";
import { resetEnvCacheForTests } from "@/lib/config/env";

const original = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in original)) delete process.env[key];
  }
  Object.assign(process.env, original);
  resetEnvCacheForTests();
});

describe("GET /api/health", () => {
  it("reports configured routing without exposing provider secrets", async () => {
    process.env.LLM_PROVIDER = "auto";
    process.env.GROQ_API_KEY = "groq-health-secret";
    process.env.GROQ_MODEL = "openai/gpt-oss-120b";
    process.env.GEMINI_API_KEY = "gemini-health-secret";
    process.env.GEMINI_MODEL = "gemini-3.5-flash";
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    resetEnvCacheForTests();

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    const text = await response.text();
    const payload = JSON.parse(text) as {
      configuredProviders: string[];
      routing: Record<string, Array<{ provider: string }>>;
    };

    expect(response.status).toBe(200);
    expect(payload.configuredProviders).toEqual(["groq", "gemini"]);
    expect(payload.routing.concept_architect.map((item) => item.provider)).toEqual(["gemini", "groq"]);
    expect(payload.routing.learning_path.map((item) => item.provider)).toEqual(["groq", "gemini"]);
    expect(text).not.toContain("groq-health-secret");
    expect(text).not.toContain("gemini-health-secret");
  });
});
