import { getEnv } from "@/lib/config/env";
import type { LLMProvider } from "@/lib/llm/provider";
import { LLMConfigurationError } from "@/lib/llm/provider";
import { OpenAICompatibleProvider } from "@/lib/llm/providers/openai-compatible";

export function createLLMProvider(
  providerName = getEnv().LLM_PROVIDER,
  modelOverride?: string,
): LLMProvider {
  const env = getEnv();

  if (providerName === "groq") {
    if (!env.GROQ_API_KEY) throw new LLMConfigurationError("GROQ_API_KEY is required when LLM_PROVIDER=groq.");
    return new OpenAICompatibleProvider(
      "groq",
      modelOverride || env.LLM_MODEL || "openai/gpt-oss-20b",
      "https://api.groq.com/openai/v1",
      env.GROQ_API_KEY,
    );
  }

  const model = modelOverride || env.LLM_MODEL;
  if (!env.LLM_BASE_URL || !env.LLM_API_KEY || !model) {
    throw new LLMConfigurationError(
      "LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL are required when LLM_PROVIDER=openai-compatible.",
    );
  }
  return new OpenAICompatibleProvider("openai-compatible", model, env.LLM_BASE_URL, env.LLM_API_KEY);
}
