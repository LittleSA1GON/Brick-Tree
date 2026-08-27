import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentRegistry } from "@/lib/agents/registry";
import { AgentRuntime } from "@/lib/agents/runtime";
import { ToolRegistry } from "@/lib/tools/registry";
import { TraceCollector } from "@/lib/observability/trace";

const output = z.object({ ok: z.boolean() });

function agent(name: string, allowedTools: string[], allowedHandoffs: string[]) {
  return {
    name,
    description: "test",
    instructions: "test",
    allowedTools,
    allowedHandoffs,
    maxSteps: 2,
    outputSchema: output,
    schemaName: "Test",
    schemaHint: "{ok:boolean}",
    buildUserPrompt: () => "test",
  };
}

describe("generic agent runtime permissions", () => {
  it("enforces tool allowlists", async () => {
    const agents = new AgentRegistry().register(agent("reader", ["echo"], []));
    const tools = new ToolRegistry().register({
      name: "echo",
      inputSchema: z.object({ value: z.string() }),
      async execute(input: { value: string }) { return input.value; },
    });
    const runtime = new AgentRuntime(agents, tools);
    const trace = new TraceCollector();
    await expect(runtime.executeTool("reader", "echo", { value: "hello" }, trace)).resolves.toBe("hello");
    await expect(runtime.executeTool("reader", "other", {}, trace)).rejects.toThrow("not allowed");
  });

  it("enforces handoff allowlists and emits structured collaboration messages", () => {
    const agents = new AgentRegistry()
      .register(agent("architect", [], ["validator"]))
      .register(agent("validator", [], []));
    const runtime = new AgentRuntime(agents, new ToolRegistry());
    const trace = new TraceCollector();
    const message = runtime.handoff("architect", "validator", trace, {
      summary: "review",
      context: { nodeId: "node-1", titles: ["A", "B"] },
    });

    expect(message.id).toBeTruthy();
    expect(message.fromAgent).toBe("architect");
    expect(message.toAgent).toBe("validator");
    expect(message.summary).toBe("review");
    expect(message.timestamp).toBeTruthy();
    expect(message.context).toEqual({ nodeId: "node-1", titles: ["A", "B"] });

    const event = trace.list().find((item) => item.type === "handoff");
    expect(event?.metadata?.handoffId).toBe(message.id);
    expect(event?.metadata?.toAgent).toBe("validator");
    expect(event?.metadata?.context).toEqual(message.context);

    expect(() => runtime.handoff("validator", "architect", trace, {
      summary: "retry",
      context: {},
    })).toThrow("not allowed");
    expect(() => runtime.handoff("architect", "missing", trace, {
      summary: "missing target",
      context: {},
    })).toThrow("Unknown agent");
  });
});
