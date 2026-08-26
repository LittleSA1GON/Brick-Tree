import { getEnv, selectedProviderHasCredentials } from "@/lib/config/env";
import { publicAgentList } from "@/lib/agents/orchestrator";

export const runtime = "nodejs";

export async function GET() {
  const env = getEnv();
  return Response.json({
    ok: true,
    app: "Brick Tree",
    runtime: "vercel-stateless",
    persistentStorage: false,
    llmProvider: env.LLM_PROVIDER,
    llmConfigured: selectedProviderHasCredentials(),
    webSearchConfigured: Boolean(env.TAVILY_API_KEY),
    ragConfigured: Boolean(env.LOCAL_RAG_BASE_URL),
    agents: publicAgentList(),
  });
}
