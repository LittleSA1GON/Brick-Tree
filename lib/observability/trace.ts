export type AgentTraceEventType =
  | "agent_start"
  | "model_call"
  | "tool_call"
  | "tool_result"
  | "handoff"
  | "validation"
  | "revision"
  | "agent_finish"
  | "error";

export type AgentTraceEvent = {
  id: string;
  timestamp: string;
  agent?: string;
  type: AgentTraceEventType;
  summary: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
};

export class TraceCollector {
  private readonly events: AgentTraceEvent[] = [];

  add(
    type: AgentTraceEventType,
    summary: string,
    options: {
      agent?: string;
      durationMs?: number;
      metadata?: Record<string, unknown>;
    } = {},
  ): AgentTraceEvent {
    const event: AgentTraceEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      type,
      summary,
      ...options,
    };
    this.events.push(event);
    return event;
  }

  list(): AgentTraceEvent[] {
    return [...this.events];
  }
}
