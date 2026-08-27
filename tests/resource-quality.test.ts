import { describe, expect, it } from "vitest";
import { resourcePlannerAgent } from "@/lib/agents/resource-agent";
import { ResourceQueryPlanSchema } from "@/lib/schemas/resources";


describe("resource quality policy", () => {
  it("does not allow Wikipedia as a resource-plan source", () => {
    expect(() =>
      ResourceQueryPlanSchema.parse({
        queries: [
          {
            query: "calculus overview",
            source: "wikipedia",
            reason: "generic reference",
          },
        ],
      }),
    ).toThrow();
  });

  it("limits the resource agent to scholarly and trusted web tools", () => {
    expect(resourcePlannerAgent.allowedTools).toEqual([
      "search_academic_resources",
      "search_web",
    ]);
  });
});
