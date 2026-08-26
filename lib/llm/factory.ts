import { getEnv, type AppEnv, type ProviderName } from "@/lib/config/env";
import type { LLMProvider, StructuredGenerationInput, StructuredGenerationResult } from "@/lib/llm/provider";
import { LLMConfigurationError } from "@/lib/llm/provider";
import { OpenAICompatibleProvider } from "@/lib/llm/providers/openai-compatible";

export type ProviderAttempt = {
  provider: ProviderName;
  model?: string;
};

class AutoFallbackProvider implements LLMProvider {
  readonly name: string;
  readonly model: string;

  constructor(private readonly providers: LLMProvider[]) {
    this.name = providers.map((provider) => provider.name).join(" → ");
    this.model = providers.map((provider) => provider.model).join(" → ");
  }

  async generateStructured<T>(input: StructuredGenerationInput<T>): Promise<StructuredGenerationResult<T>> {
    let lastError: unknown;
    for (const provider of this.providers) {
      try {
        return await provider.generateStructured(input);
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError instanceof Error) throw lastError;
    throw new LLMConfigurationError("Every configured LLM provider failed.");
  }
}

const DEFAULT_ORDER: ProviderName[] = ["groq", "gemini", "openrouter", "openai-compatible"];

const ROLE_ORDER: Record<string, ProviderName[]> = {
  concept_architect: ["gemini", "groq", "openrouter", "openai-compatible"],
  learning_path: ["groq", "gemini", "openrouter", "openai-compatible"],
  pedagogy_validator: ["openrouter", "gemini", "groq", "openai-compatible"],
  resource_agent: ["groq", "openrouter", "gemini", "openai-compatible"],
  explanation: ["gemini", "groq", "openrouter", "openai-compatible"],
};

function modelFor(provider: ProviderName, env: AppEnv): string | undefined {
  switch (provider) {
    case "groq": return env.GROQ_MODEL || "openai/gpt-oss-120b";
    case "gemini": return env.GEMINI_MODEL || "gemini-3.5-flash";
    case "openrouter": return env.OPENROUTER_MODEL || "openrouter/free";
    case "openai-compatible": return env.LLM_MODEL;
  }
  return undefined;
}

function isConfigured(provider: ProviderName, env: AppEnv): boolean {
  switch (provider) {
    case "groq": return Boolean(env.GROQ_API_KEY);
    case "gemini": return Boolean(env.GEMINI_API_KEY);
    case "openrouter": return Boolean(env.OPENROUTER_API_KEY);
    case "openai-compatible": return Boolean(env.LLM_BASE_URL && env.LLM_API_KEY && env.LLM_MODEL);
  }
  return false;
}

function roleOverride(role: string | undefined, env: AppEnv): ProviderName | undefined {
  switch (role) {
    case "concept_architect": return env.CONCEPT_ARCHITECT_PROVIDER;
    case "learning_path": return env.LEARNING_PATH_PROVIDER;
    case "pedagogy_validator": return env.PEDAGOGY_VALIDATOR_PROVIDER;
    case "resource_agent": return env.RESOURCE_AGENT_PROVIDER;
    case "explanation": return env.EXPLANATION_PROVIDER;
    default: return undefined;
  }
}

export function getLLMProviderAttempts(role?: string): ProviderAttempt[] {
  const env = getEnv();

  if (env.LLM_PROVIDER !== "auto") {
    const attempts: ProviderAttempt[] = [{
      provider: env.LLM_PROVIDER,
      model: modelFor(env.LLM_PROVIDER, env),
    }];
    if (env.LLM_FALLBACK_PROVIDER && env.LLM_FALLBACK_PROVIDER !== env.LLM_PROVIDER) {
      attempts.push({
        provider: env.LLM_FALLBACK_PROVIDER,
        model: env.LLM_FALLBACK_MODEL || modelFor(env.LLM_FALLBACK_PROVIDER, env),
      });
    }
    return attempts;
  }

  const preferred = roleOverride(role, env);
  const order = [preferred, ...(ROLE_ORDER[role || ""] || DEFAULT_ORDER)]
    .filter((provider): provider is ProviderName => Boolean(provider));

  return [...new Set(order)]
    .filter((provider) => isConfigured(provider, env))
    .map((provider) => ({ provider, model: modelFor(provider, env) }));
}

export function createLLMProvider(
  providerName: ProviderName | "auto" = getEnv().LLM_PROVIDER,
  modelOverride?: string,
): LLMProvider {
  const env = getEnv();

  if (providerName === "auto") {
    const attempts = getLLMProviderAttempts();
    if (!attempts.length) {
      throw new LLMConfigurationError(
        "No LLM provider is configured. Add GROQ_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY, or a complete OpenAI-compatible endpoint.",
      );
    }
    return new AutoFallbackProvider(
      attempts.map((attempt) => createLLMProvider(attempt.provider, modelOverride || attempt.model)),
    );
  }

  const model = modelOverride || modelFor(providerName, env);

  switch (providerName) {
    case "groq":
      if (!env.GROQ_API_KEY) throw new LLMConfigurationError("GROQ_API_KEY is required when using Groq.");
      return new OpenAICompatibleProvider(
        "groq",
        model || "openai/gpt-oss-120b",
        "https://api.groq.com/openai/v1",
        env.GROQ_API_KEY,
      );

    case "gemini":
      if (!env.GEMINI_API_KEY) throw new LLMConfigurationError("GEMINI_API_KEY is required when using Gemini.");
      return new OpenAICompatibleProvider(
        "gemini",
        model || "gemini-3.5-flash",
        "https://generativelanguage.googleapis.com/v1beta/openai",
        env.GEMINI_API_KEY,
      );

    case "openrouter":
      if (!env.OPENROUTER_API_KEY) throw new LLMConfigurationError("OPENROUTER_API_KEY is required when using OpenRouter.");
      return new OpenAICompatibleProvider(
        "openrouter",
        model || "openrouter/free",
        "https://openrouter.ai/api/v1",
        env.OPENROUTER_API_KEY,
      );

    case "openai-compatible":
      if (!env.LLM_BASE_URL || !env.LLM_API_KEY || !model) {
        throw new LLMConfigurationError(
          "LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL are required when using openai-compatible.",
        );
      }
      return new OpenAICompatibleProvider("openai-compatible", model, env.LLM_BASE_URL, env.LLM_API_KEY);
  }

  throw new LLMConfigurationError(`Unsupported LLM provider: ${providerName}`);
}
