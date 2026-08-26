import { afterEach, describe, expect, it } from "vitest";
import { getEnv, resetEnvCacheForTests, selectedProviderHasCredentials } from "@/lib/config/env";
import { createLLMProvider, getLLMProviderAttempts } from "@/lib/llm/factory";

const keys = [
  "APP_CONTACT_EMAIL",
  "LLM_PROVIDER",
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "LLM_MODEL",
  "GROQ_API_KEY",
  "GROQ_MODEL",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
  "LOCAL_RAG_BASE_URL",
  "AGENT_MAX_STEPS",
  "AGENT_MAX_REVISIONS",
] as const;
const original = new Map(keys.map((key) => [key, process.env[key]]));

function restore() {
  for (const key of keys) {
    const value = original.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvCacheForTests();
}

afterEach(restore);

describe("environment parsing", () => {
  it("treats blank optional settings as unconfigured and uses numeric defaults", () => {
    for (const key of keys) process.env[key] = "";
    resetEnvCacheForTests();
    const env = getEnv();
    expect(env.LLM_PROVIDER).toBe("auto");
    expect(env.APP_CONTACT_EMAIL).toBeUndefined();
    expect(env.LLM_BASE_URL).toBeUndefined();
    expect(env.LOCAL_RAG_BASE_URL).toBeUndefined();
    expect(env.AGENT_MAX_STEPS).toBe(5);
    expect(env.AGENT_MAX_REVISIONS).toBe(2);
  });

  it("normalizes auto mode and only includes configured providers", () => {
    process.env.LLM_PROVIDER = " auto ";
    process.env.GROQ_API_KEY = "groq-test";
    process.env.GROQ_MODEL = "openai/gpt-oss-120b";
    process.env.GEMINI_API_KEY = "gemini-test";
    process.env.GEMINI_MODEL = "gemini-3.5-flash";
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    resetEnvCacheForTests();

    expect(selectedProviderHasCredentials()).toBe(true);
    expect(getLLMProviderAttempts("learning_path").map((attempt) => attempt.provider)).toEqual(["groq", "gemini"]);
    expect(getLLMProviderAttempts("concept_architect").map((attempt) => attempt.provider)).toEqual(["gemini", "groq"]);
    expect(createLLMProvider().name).toBe("groq → gemini");
  });

  it("requires model, URL and key for a generic OpenAI-compatible provider", () => {
    process.env.LLM_PROVIDER = "openai-compatible";
    process.env.LLM_BASE_URL = "https://example.com/v1";
    process.env.LLM_API_KEY = "test";
    process.env.LLM_MODEL = "model";
    resetEnvCacheForTests();
    expect(selectedProviderHasCredentials()).toBe(true);
  });
});
