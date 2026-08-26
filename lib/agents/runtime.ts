import { getEnv } from "@/lib/config/env";
import {
  createLLMProvider,
  getConfiguredProviderNames,
  getLLMProviderAttempts,
  getShortestProviderCooldownMs,
  waitForProviderAttempt,
} from "@/lib/llm/factory";
import { markProviderCooldown, markProviderRateLimited } from "@/lib/llm/cooldown";
import { LLMConfigurationError, LLMResponseError, type LLMProvider } from "@/lib/llm/provider";
import type { TraceCollector } from "@/lib/observability/trace";
import type { ToolRegistry } from "@/lib/tools/registry";
import type { AgentRegistry } from "@/lib/agents/registry";
import type { ExtractedDocument } from "@/lib/schemas/documents";

export type AgentRunResult<T> = {
  data: T;
  provider: string;
  model: string;
};

export class AgentRuntime {
  constructor(
    private readonly agents: AgentRegistry,
    private readonly tools: ToolRegistry,
  ) {}

  async run<TInput, TOutput>(
    agentName: string,
    input: TInput,
    trace: TraceCollector,
  ): Promise<AgentRunResult<TOutput>> {
    const agent = this.agents.get<TInput, TOutput>(agentName);
    const env = getEnv();
    trace.add("agent_start", agent.description, { agent: agent.name });

    const attempts = getLLMProviderAttempts(agentName);
    if (!attempts.length) {
      const configured = getConfiguredProviderNames();
      const cooldownMs = getShortestProviderCooldownMs();

      if (configured.length && cooldownMs > 0) {
        throw new LLMResponseError(
          `All configured AI providers are cooling down after rate limits or temporary failures. Try again in about ${Math.max(1, Math.ceil(cooldownMs / 1000))} seconds.`,
          { kind: "rate_limit", status: 429, retryAfterMs: cooldownMs },
        );
      }

      throw new LLMConfigurationError(
        "No configured LLM provider is available. Add a Groq, Gemini, Cloudflare Workers AI, OpenRouter key, or configure a complete OpenAI-compatible endpoint.",
      );
    }

    let lastError: unknown;

    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      const attempt = attempts[attemptIndex];
      let provider: LLMProvider;

      try {
        provider = createLLMProvider(attempt.provider, attempt.model);
      } catch (error) {
        lastError = error;
        continue;
      }

      const hasAnotherProvider = attemptIndex < attempts.length - 1;
      const repairLimit = hasAnotherProvider
        ? 1
        : Math.min(1 + env.AGENT_MAX_REVISIONS, agent.maxSteps, env.AGENT_MAX_STEPS);

      for (let repairAttempt = 0; repairAttempt < repairLimit; repairAttempt += 1) {
        try {
          await waitForProviderAttempt(attempt.provider);

          trace.add("model_call", `${agent.name} requested structured output from ${provider.name}.`, {
            agent: agent.name,
            metadata: {
              provider: provider.name,
              model: provider.model,
              repairAttempt,
            },
          });

          const result = await provider.generateStructured<TOutput>({
            system:
              agent.instructions +
              (repairAttempt
                ? "\n\nYour previous response did not satisfy the required structure. Return the exact JSON contract with no extra text."
                : ""),
            user: agent.buildUserPrompt(input),
            schema: agent.outputSchema,
            schemaName: agent.schemaName,
            schemaHint: agent.schemaHint,
            temperature: repairAttempt ? 0 : 0.2,
            maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
          });

          trace.add("agent_finish", `${agent.name} produced validated structured output.`, {
            agent: agent.name,
            durationMs: result.latencyMs,
            metadata: { provider: result.provider, model: result.model },
          });

          return {
            data: result.data,
            provider: result.provider,
            model: result.model,
          };
        } catch (error) {
          lastError = error;
          const responseError = error instanceof LLMResponseError ? error : undefined;

          trace.add("error", `${agent.name} structured generation attempt failed.`, {
            agent: agent.name,
            metadata: {
              provider: attempt.provider,
              message: error instanceof Error ? error.message : String(error),
              kind: responseError?.kind,
              status: responseError?.status,
            },
          });

          if (responseError?.kind === "rate_limit") {
            markProviderRateLimited(
              attempt.provider,
              responseError.retryAfterMs,
              env.LLM_PROVIDER_COOLDOWN_SECONDS * 1000,
            );
          } else if (responseError?.shouldCooldownProvider) {
            markProviderCooldown(
              attempt.provider,
              responseError.retryAfterMs ?? env.LLM_PROVIDER_COOLDOWN_SECONDS * 1000,
            );
          }

          // If another provider exists, move to it immediately instead of spending
          // another request on the same provider. Same-provider repair is only a
          // last resort when there is no configured fallback.
          if (hasAnotherProvider || !responseError?.allowsSameProviderRepair) break;
        }
      }
    }

    if (lastError instanceof LLMConfigurationError) throw lastError;
    if (lastError instanceof Error) throw lastError;
    throw new Error(`${agentName} could not complete.`);
  }

  handoff(fromAgent: string, toAgent: string, trace: TraceCollector, summary: string): void {
    const source = this.agents.get(fromAgent);
    if (!source.allowedHandoffs.includes(toAgent)) {
      throw new Error(`${fromAgent} is not allowed to hand off to ${toAgent}.`);
    }
    trace.add("handoff", summary, { agent: fromAgent, metadata: { toAgent } });
  }

  async executeTool(
    agentName: string,
    toolName: string,
    input: unknown,
    trace: TraceCollector,
    context?: { documents?: ExtractedDocument[]; signal?: AbortSignal },
  ): Promise<unknown> {
    const agent = this.agents.get(agentName);
    return this.tools.execute(toolName, input, agent.allowedTools, {
      trace,
      agentName,
      ...context,
    });
  }
}
