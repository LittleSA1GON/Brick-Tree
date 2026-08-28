import { getEnv, selectedProviderHasCredentials, type ProviderName } from "@/lib/config/env";
import { publicAgentList } from "@/lib/agents/orchestrator";
import { getLLMProviderAttempts } from "@/lib/llm/factory";

export const runtime = "nodejs";

const PROVIDERS: ProviderName[] = ["groq", "gemini", "cloudflare", "openrouter", "openai-compatible"];
const ROUTED_ROLES = [
  "concept_architect",
  "learning_path",
  "pedagogy_validator",
  "resource_agent",
  "explanation",
] as const;

export async function GET() {
  const env = getEnv();
  const configuredProviders = PROVIDERS.filter((provider) => selectedProviderHasCredentials(provider));
  const routing = Object.fromEntries(
    ROUTED_ROLES.map((role) => [
      role,
      getLLMProviderAttempts(role).map((attempt) => ({
        provider: attempt.provider,
        model: attempt.model,
      })),
    ]),
  );

  return Response.json({
    ok: true,
    app: "Brick Tree",
    version: "0.9.0",
    runtime: "vercel-stateless",
    persistentStorage: false,
    llmProvider: env.LLM_PROVIDER,
    llmConfigured: configuredProviders.length > 0,
    configuredProviders,
    routing,
    rateProtection: {
      cooldownSeconds: env.LLM_PROVIDER_COOLDOWN_SECONDS,
      maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
      deterministicPedagogyValidation: env.PEDAGOGY_VALIDATION_MODE === "deterministic",
    },
    resources: {
      webSearchConfigured: Boolean(env.TAVILY_API_KEY || env.BRAVE_SEARCH_API_KEY),
      providers: {
        tavily: Boolean(env.TAVILY_API_KEY),
        brave: Boolean(env.BRAVE_SEARCH_API_KEY),
        openAlex: true,
        crossref: true,
        semanticScholar: Boolean(env.SEMANTIC_SCHOLAR_API_KEY),
      },
    },
    ragConfigured: Boolean(env.LOCAL_RAG_BASE_URL),
    agents: publicAgentList(),
  });
}
