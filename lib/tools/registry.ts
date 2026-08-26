import type { AgentTool, ToolContext } from "@/lib/tools/base";

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool<any, any>>();

  register<TInput, TOutput>(tool: AgentTool<TInput, TOutput>): this {
    if (this.tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`);
    this.tools.set(tool.name, tool as AgentTool<any, any>);
    return this;
  }

  async execute(
    name: string,
    rawInput: unknown,
    allowedTools: string[],
    context: ToolContext,
  ): Promise<unknown> {
    if (!allowedTools.includes(name)) {
      throw new Error(`Agent ${context.agentName} is not allowed to use tool ${name}.`);
    }
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    const input = tool.inputSchema.parse(rawInput);
    context.trace.add("tool_call", `Calling ${name}`, { agent: context.agentName });
    const started = Date.now();
    const timeoutSignal = AbortSignal.timeout(tool.timeoutMs ?? 12_000);
    const signal = context.signal ? AbortSignal.any([context.signal, timeoutSignal]) : timeoutSignal;
    const output = await tool.execute(input, { ...context, signal });
    context.trace.add("tool_result", `${name} returned successfully`, {
      agent: context.agentName,
      durationMs: Date.now() - started,
    });
    return output;
  }
}
