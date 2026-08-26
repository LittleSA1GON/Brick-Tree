import { z } from "zod";

const optionalText = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), schema.optional());

const ProviderSchema = z.enum(["groq", "openai-compatible"]);

const EnvSchema = z.object({
  LLM_PROVIDER: ProviderSchema.default("groq"),
  LLM_MODEL: optionalText(z.string()),
  LLM_FALLBACK_PROVIDER: optionalText(ProviderSchema),
  LLM_FALLBACK_MODEL: optionalText(z.string()),
  GROQ_API_KEY: optionalText(z.string()),
  LLM_API_KEY: optionalText(z.string()),
  LLM_BASE_URL: optionalText(z.string().url()),
  TAVILY_API_KEY: optionalText(z.string()),
  APP_CONTACT_EMAIL: optionalText(z.string().email()),
  LOCAL_RAG_BASE_URL: optionalText(z.string().url()),
  AGENT_MAX_STEPS: z.coerce.number().int().min(1).max(12).default(5),
  AGENT_MAX_REVISIONS: z.coerce.number().int().min(0).max(4).default(2),
});

export type AppEnv = z.infer<typeof EnvSchema>;
let cached: AppEnv | undefined;

export function getEnv(): AppEnv {
  if (!cached) cached = EnvSchema.parse(process.env);
  return cached;
}

export function resetEnvCacheForTests(): void {
  cached = undefined;
}

export function selectedProviderHasCredentials(provider = getEnv().LLM_PROVIDER): boolean {
  const env = getEnv();
  return provider === "groq"
    ? Boolean(env.GROQ_API_KEY)
    : Boolean(env.LLM_BASE_URL && env.LLM_API_KEY && env.LLM_MODEL);
}
