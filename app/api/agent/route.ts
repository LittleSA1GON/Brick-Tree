import { AgentRequestSchema } from "@/lib/schemas/api";
import { branchFromConcept, discoverLearningPath, explainConcept, findResources, navigateTree } from "@/lib/agents/orchestrator";
import { LLMConfigurationError, LLMResponseError } from "@/lib/llm/provider";
import { assertSameOrigin, requestBodyTooLarge } from "@/lib/utils/request";

export const runtime = "nodejs";
export const maxDuration = 60;

function errorResponse(code: string, message: string, status = 400) {
  return Response.json(
    { ok: false, trace: [], warnings: [], error: { code, message } },
    { status },
  );
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch {
    return errorResponse("invalid_origin", "Cross-origin agent requests are not allowed.", 403);
  }

  const maxRequestBytes = 3_500_000;
  if (requestBodyTooLarge(request, maxRequestBytes)) {
    return errorResponse("request_too_large", "This request is too large for the interactive agent endpoint.", 413);
  }

  let body: unknown;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > maxRequestBytes) {
      return errorResponse("request_too_large", "This request is too large for the interactive agent endpoint.", 413);
    }
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse("invalid_json", "Request body must be valid JSON.");
  }

  const parsed = AgentRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      "invalid_request",
      parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  }

  try {
    const action = parsed.data;
    const documents = action.documents;

    if (action.action === "navigate") {
      if (action.traversal.mode === "tree") {
        const result = await navigateTree({
          intent: action.traversal.intent,
          topic: action.node?.title ?? action.topic!,
          parentNode: action.node,
          graphContext: action.graphContext,
          learnerProfile: action.learnerProfile,
          documents,
        });
        return Response.json({ ok: true, ...result });
      }

      const goal = action.goal ?? action.learnerProfile?.learningGoal ?? action.learnerProfile?.goal;
      if (action.node && action.graphContext) {
        const result = await branchFromConcept({
          intent: action.traversal.intent,
          node: action.node,
          graphContext: action.graphContext,
          goal,
          learnerProfile: action.learnerProfile,
          documents,
        });
        return Response.json({ ok: true, ...result });
      }

      const knownConcepts = action.knownConcepts?.length
        ? action.knownConcepts
        : action.learnerProfile?.existingKnowledge ?? [];
      const result = await discoverLearningPath({
        intent: action.traversal.intent,
        knownConcepts,
        rawKnowledgeInput: action.rawKnowledgeInput,
        goal,
        learnerProfile: action.learnerProfile,
        documents,
      });
      return Response.json({ ok: true, ...result });
    }

    if (action.action === "resources") {
      const result = await findResources({ node: action.node, learnerProfile: action.learnerProfile });
      return Response.json({ ok: true, ...result });
    }

    const result = await explainConcept({
      node: action.node,
      level: action.level,
      learnerProfile: action.learnerProfile,
      documents,
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof LLMConfigurationError) {
      return errorResponse(
        "llm_not_configured",
        `${error.message} Add a free/free-tier provider key in Vercel or .env.local, or point the OpenAI-compatible adapter at a local model during development.`,
        503,
      );
    }
    if (error instanceof LLMResponseError) {
      const status = error.status === 429 ? 429 : error.status && error.status >= 400 && error.status < 600 ? error.status : 503;
      const code = error.kind === "rate_limit" ? "provider_rate_limited" : "provider_failed";
      return errorResponse(code, error.message.slice(0, 900), status);
    }
    const message = error instanceof Error ? error.message : "Unknown agent error.";
    return errorResponse("agent_failed", message.slice(0, 900), 500);
  }
}
