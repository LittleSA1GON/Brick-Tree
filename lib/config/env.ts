import { z } from "zod";

const optionalText = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    schema.optional(),
  );

export const ProviderSchema = z.enum([
  "groq",
  "gemini",
  "openrouter",
  "openai-compatible",
]);

const ProviderSelectionSchema = z.union([
  z.literal("auto"),
  ProviderSchema,
]);

const EnvSchema = z.object({
  LLM_PROVIDER: ProviderSelectionSchema.default("auto"),

  // Backward-compatible fallback settings used by runtime.ts
  LLM_FALLBACK_PROVIDER: optionalText(ProviderSchema),
  LLM_FALLBACK_MODEL: optionalText(z.string()),

  // Groq
  GROQ_API_KEY: optionalText(z.string()),
  GROQ_MODEL: optionalText(z.string()),

  // Gemini
  GEMINI_API_KEY: optionalText(z.string()),
  GEMINI_MODEL: optionalText(z.string()),

  // OpenRouter
  OPENROUTER_API_KEY: optionalText(z.string()),
  OPENROUTER_MODEL: optionalText(z.string()),

  // Generic OpenAI-compatible provider
  LLM_API_KEY: optionalText(z.string()),
  LLM_BASE_URL: optionalText(z.string().url()),
  LLM_MODEL: optionalText(z.string()),

  // Optional per-role routing
  CONCEPT_ARCHITECT_PROVIDER: optionalText(ProviderSchema),
  LEARNING_PATH_PROVIDER: optionalText(ProviderSchema),
  PEDAGOGY_VALIDATOR_PROVIDER: optionalText(ProviderSchema),
  RESOURCE_AGENT_PROVIDER: optionalText(ProviderSchema),
  EXPLANATION_PROVIDER: optionalText(ProviderSchema),

  // Resource/search providers
  TAVILY_API_KEY: optionalText(z.string()),
  BRAVE_SEARCH_API_KEY: optionalText(z.string()),
  SEMANTIC_SCHOLAR_API_KEY: optionalText(z.string()),
  OPENALEX_API_KEY: optionalText(z.string()),
  APP_CONTACT_EMAIL: optionalText(z.string().email()),

  // Optional RAG
  LOCAL_RAG_BASE_URL: optionalText(z.string().url()),

  // Agent bounds
  AGENT_MAX_STEPS: z.coerce.number().int().min(1).max(12).default(5),
  AGENT_MAX_REVISIONS: z.coerce.number().int().min(0).max(4).default(2),
});

export type AppEnv = z.infer<typeof EnvSchema>;

let cached: AppEnv | undefined;

export function getEnv(): AppEnv {
  if (!cached) {
    cached = EnvSchema.parse(process.env);
  }

  return cached;
}

export function resetEnvCacheForTests(): void {
  cached = undefined;
}

export function selectedProviderHasCredentials(
  provider?: z.infer<typeof ProviderSchema>,
): boolean {
  const env = getEnv();

  if (!provider) {
    if (env.LLM_PROVIDER === "auto") {
      return Boolean(
        env.GROQ_API_KEY ||
          env.GEMINI_API_KEY ||
          env.OPENROUTER_API_KEY ||
          (env.LLM_BASE_URL && env.LLM_API_KEY && env.LLM_MODEL),
      );
    }

    provider = env.LLM_PROVIDER;
  }

  switch (provider) {
    case "groq":
      return Boolean(env.GROQ_API_KEY);

    case "gemini":
      return Boolean(env.GEMINI_API_KEY);

    case "openrouter":
      return Boolean(env.OPENROUTER_API_KEY);

    case "openai-compatible":
      return Boolean(
        env.LLM_BASE_URL &&
          env.LLM_API_KEY &&
          env.LLM_MODEL,
      );
  }
}