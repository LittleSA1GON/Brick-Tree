import { afterEach, describe, expect, it } from "vitest";
import { getEnv, resetEnvCacheForTests, selectedProviderHasCredentials } from "@/lib/config/env";

const keys = ["APP_CONTACT_EMAIL", "LLM_PROVIDER", "LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "LOCAL_RAG_BASE_URL"] as const;
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
  it("treats blank optional settings as unconfigured", () => {
    for (const key of keys) process.env[key] = "";
    resetEnvCacheForTests();
    const env = getEnv();
    expect(env.APP_CONTACT_EMAIL).toBeUndefined();
    expect(env.LLM_BASE_URL).toBeUndefined();
    expect(env.LOCAL_RAG_BASE_URL).toBeUndefined();
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
