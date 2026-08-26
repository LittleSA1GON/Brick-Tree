import type { AgentSpec } from "@/lib/agents/spec";

export class AgentRegistry {
  private readonly agents = new Map<string, AgentSpec<any, any>>();

  register<TInput, TOutput>(agent: AgentSpec<TInput, TOutput>): this {
    if (this.agents.has(agent.name)) throw new Error(`Agent already registered: ${agent.name}`);
    this.agents.set(agent.name, agent as AgentSpec<any, any>);
    return this;
  }

  get<TInput = unknown, TOutput = unknown>(name: string): AgentSpec<TInput, TOutput> {
    const agent = this.agents.get(name);
    if (!agent) throw new Error(`Unknown agent: ${name}`);
    return agent as AgentSpec<TInput, TOutput>;
  }

  list(): Array<Pick<AgentSpec, "name" | "description" | "allowedTools" | "allowedHandoffs">> {
    return [...this.agents.values()].map(({ name, description, allowedTools, allowedHandoffs }) => ({
      name,
      description,
      allowedTools,
      allowedHandoffs,
    }));
  }
}
