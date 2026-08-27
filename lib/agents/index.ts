import { AgentRegistry } from "@/lib/agents/registry";
import { conceptArchitectAgent } from "@/lib/agents/concept-architect";
import { learningPathAgent } from "@/lib/agents/learning-path";
import { pedagogyValidatorAgent } from "@/lib/agents/pedagogy-validator";
import { resourceAgent } from "@/lib/agents/resource-agent";

export function createAgentRegistry(): AgentRegistry {
  return new AgentRegistry()
    .register(conceptArchitectAgent)
    .register(learningPathAgent)
    .register(pedagogyValidatorAgent)
    .register(resourceAgent);
}
