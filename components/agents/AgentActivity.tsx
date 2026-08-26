"use client";

import type { AgentTraceEvent } from "@/lib/observability/trace";

const agentLabels: Record<string, string> = {
  concept_architect: "Concept Architect",
  learning_path: "Learning Path Agent",
  pedagogy_validator: "Pedagogy Validator",
  resource_agent: "Resource Agent",
};

export function AgentActivity({ trace, activeLabel }: { trace: AgentTraceEvent[]; activeLabel?: string }) {
  const visible = trace
    .filter((event) => ["agent_finish", "validation", "tool_result", "revision", "error"].includes(event.type))
    .slice(-5);

  return (
    <section className="agent-activity" aria-live="polite">
      <div className="section-heading-row">
        <div><span className="eyebrow">Agent activity</span><h2>How this layer was built</h2></div>
        <span className={`activity-dot ${activeLabel ? "active" : ""}`} aria-hidden="true" />
      </div>
      {activeLabel ? <div className="agent-live ui-enter-up"><span className="spinner" aria-hidden="true" />{activeLabel}</div> : null}
      <div className="agent-events">
        {visible.length ? visible.map((event) => (
          <div key={event.id} className={`agent-event event-${event.type} ui-enter-up`}>
            <span className="event-mark">{event.type === "error" ? "!" : "✓"}</span>
            <div><strong>{event.agent ? agentLabels[event.agent] ?? event.agent : "Brick Tree"}</strong><p>{event.summary}</p></div>
          </div>
        )) : <p className="muted ui-enter">Agent actions will appear here without exposing private reasoning.</p>}
      </div>
    </section>
  );
}
