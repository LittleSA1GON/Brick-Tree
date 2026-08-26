import { getEnv, type AppEnv, type ProviderName } from "@/lib/config/env";
import type { LLMProvider, StructuredGenerationInput, StructuredGenerationResult } from "@/lib/llm/provider";
import { LLMConfigurationError, LLMResponseError } from "@/lib/llm/provider";
import { OpenAICompatibleProvider } from "@/lib/llm/providers/openai-compatible";
import {
  markProviderCooldown,
  markProviderRateLimited,
  providerCooldownRemainingMs,
  providerIsCoolingDown,
  providerSlotRemainingMs,
  waitForProviderSlot,
} from "@/lib/llm/cooldown";

export type ProviderAttempt = {
  provider: ProviderName;
  model?: string;
};

class AutoFallbackProvider implements LLMProvider {
  readonly name: string;
  readonly model: string;

  constructor(
    private readonly providers: Array<{ name: ProviderName; provider: LLMProvider }>,
    private readonly cooldownMs: number,
  ) {
    this.name = providers.map((item) => item.provider.name).join(" → ");
    this.model = providers.map((item) => item.provider.model).join(" → ");
  }

  async generateStructured<T>(input: StructuredGenerationInput<T>): Promise<StructuredGenerationResult<T>> {
    let lastError: unknown;

    for (const item of this.providers) {
      if (providerIsCoolingDown(item.name)) continue;

      try {
        await waitForProviderAttempt(item.name, input.signal);
        return await item.provider.generateStructured(input);
      } catch (error) {
        lastError = error;
        if (error instanceof LLMResponseError) {
          if (error.kind === "rate_limit") {
            markProviderRateLimited(item.name, error.retryAfterMs, this.cooldownMs);
          } else if (error.shouldCooldownProvider) {
            markProviderCooldown(item.name, error.retryAfterMs ?? this.cooldownMs);
          }
        }
      }
    }

    if (lastError instanceof Error) throw lastError;
    throw new LLMConfigurationError("Every configured LLM provider is unavailable or cooling down.");
  }
}

const DEFAULT_ORDER: ProviderName[] = ["gemini", "cloudflare", "groq", "openrouter", "openai-compatible"];

const ROLE_ORDER: Record<string, ProviderName[]> = {
  concept_architect: ["gemini", "cloudflare", "groq", "openrouter", "openai-compatible"],
  learning_path: ["groq", "gemini", "cloudflare", "openrouter", "openai-compatible"],
  pedagogy_validator: ["cloudflare", "openrouter", "gemini", "groq", "openai-compatible"],
  resource_agent: ["cloudflare", "gemini", "groq", "openrouter", "openai-compatible"],
  explanation: ["gemini", "groq", "cloudflare", "openrouter", "openai-compatible"],
};

function modelFor(provider: ProviderName, env: AppEnv): string | undefined {
  switch (provider) {
    case "groq":
      return env.GROQ_MODEL || "openai/gpt-oss-120b";
    case "gemini":
      return env.GEMINI_MODEL || "gemini-3.5-flash";
    case "cloudflare":
      return env.CLOUDFLARE_MODEL || "@cf/openai/gpt-oss-20b";
    case "openrouter":
      return env.OPENROUTER_MODEL || "openrouter/free";
    case "openai-compatible":
      return env.LLM_MODEL;
  }
}

function minimumIntervalFor(provider: ProviderName, env: AppEnv): number {
  switch (provider) {
    case "groq":
      return env.GROQ_MIN_PROVIDER_INTERVAL_MS;
    case "gemini":
      return env.GEMINI_MIN_PROVIDER_INTERVAL_MS;
    case "cloudflare":
      return env.CLOUDFLARE_MIN_PROVIDER_INTERVAL_MS;
    case "openrouter":
      return env.OPENROUTER_MIN_PROVIDER_INTERVAL_MS;
    case "openai-compatible":
      return env.LLM_MIN_PROVIDER_INTERVAL_MS;
  }
}

function isConfigured(provider: ProviderName, env: AppEnv): boolean {
  switch (provider) {
    case "groq":
      return Boolean(env.GROQ_API_KEY);
    case "gemini":
      return Boolean(env.GEMINI_API_KEY);
    case "cloudflare":
      return Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN);
    case "openrouter":
      return Boolean(env.OPENROUTER_API_KEY);
    case "openai-compatible":
      return Boolean(env.LLM_BASE_URL && env.LLM_API_KEY && env.LLM_MODEL);
  }
}

function roleOverride(role: string | undefined, env: AppEnv): ProviderName | undefined {
  switch (role) {
    case "concept_architect":
      return env.CONCEPT_ARCHITECT_PROVIDER;
    case "learning_path":
      return env.LEARNING_PATH_PROVIDER;
    case "pedagogy_validator":
      return env.PEDAGOGY_VALIDATOR_PROVIDER;
    case "resource_agent":
      return env.RESOURCE_AGENT_PROVIDER;
    case "explanation":
      return env.EXPLANATION_PROVIDER;
    default:
      return undefined;
  }
}

function orderByAvailability(attempts: ProviderAttempt[]): ProviderAttempt[] {
  return attempts
    .map((attempt, index) => ({
      attempt,
      index,
      waitMs: providerSlotRemainingMs(attempt.provider),
    }))
    .sort((a, b) => a.waitMs - b.waitMs || a.index - b.index)
    .map((item) => item.attempt);
}

export function getConfiguredProviderNames(): ProviderName[] {
  const env = getEnv();
  return (["groq", "gemini", "cloudflare", "openrouter", "openai-compatible"] as ProviderName[])
    .filter((provider) => isConfigured(provider, env));
}

export function getShortestProviderCooldownMs(): number {
  const remaining = getConfiguredProviderNames()
    .map((provider) => providerCooldownRemainingMs(provider))
    .filter((value) => value > 0);
  return remaining.length ? Math.min(...remaining) : 0;
}

export function getLLMProviderAttempts(role?: string): ProviderAttempt[] {
  const env = getEnv();

  if (env.LLM_PROVIDER !== "auto") {
    const requested: ProviderAttempt[] = [{
      provider: env.LLM_PROVIDER,
      model: modelFor(env.LLM_PROVIDER, env),
    }];

    if (env.LLM_FALLBACK_PROVIDER && env.LLM_FALLBACK_PROVIDER !== env.LLM_PROVIDER) {
      requested.push({
        provider: env.LLM_FALLBACK_PROVIDER,
        model: env.LLM_FALLBACK_MODEL || modelFor(env.LLM_FALLBACK_PROVIDER, env),
      });
    }

    return orderByAvailability(
      requested.filter(
        (attempt) => isConfigured(attempt.provider, env) && !providerIsCoolingDown(attempt.provider),
      ),
    );
  }

  const preferred = roleOverride(role, env);
  const order = [preferred, ...(ROLE_ORDER[role || ""] || DEFAULT_ORDER)]
    .filter((provider): provider is ProviderName => Boolean(provider));

  const attempts = [...new Set(order)]
    .filter((provider) => isConfigured(provider, env) && !providerIsCoolingDown(provider))
    .map((provider) => ({ provider, model: modelFor(provider, env) }));

  return orderByAvailability(attempts);
}

export async function waitForProviderAttempt(provider: ProviderName, signal?: AbortSignal): Promise<void> {
  const env = getEnv();
  await waitForProviderSlot(provider, minimumIntervalFor(provider, env), signal);
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
        "No LLM provider is currently available. Configure Groq, Gemini, Cloudflare Workers AI, OpenRouter, or a complete OpenAI-compatible endpoint.",
      );
    }

    return new AutoFallbackProvider(
      attempts.map((attempt) => ({
        name: attempt.provider,
        provider: createLLMProvider(attempt.provider, modelOverride || attempt.model),
      })),
      env.LLM_PROVIDER_COOLDOWN_SECONDS * 1000,
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

    case "cloudflare":
      if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
        throw new LLMConfigurationError(
          "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required when using Cloudflare Workers AI.",
        );
      }
      return new OpenAICompatibleProvider(
        "cloudflare",
        model || "@cf/openai/gpt-oss-20b",
        `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1`,
        env.CLOUDFLARE_API_TOKEN,
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
}
