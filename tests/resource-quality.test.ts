import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const orchestrator = read("lib/agents/orchestrator.ts");
const resourceAgent = read("lib/agents/resource-agent.ts");
const resourceStrategy = read("lib/agents/resource-strategy.ts");
const resources = read("lib/schemas/resources.ts");
const toolIndex = read("lib/tools/index.ts");
const webTool = read("lib/tools/implementations/web-search.ts");
const academicTool = read("lib/tools/implementations/academic-search.ts");
const apiSchema = read("lib/schemas/api.ts");
const resourceRequestBlock = apiSchema.slice(
  apiSchema.indexOf("const ResourcesRequestSchema"),
  apiSchema.indexOf("const ExplainRequestSchema"),
);

describe("source-neutral, learner-aware resource quality", () => {
  it("removes the curated preferred-site catalog and domain whitelist", () => {
    expect(fs.existsSync(path.join(root, "lib/tools/implementations/institution-search.ts"))).toBe(false);
    expect(toolIndex).not.toContain("institutionSearchTool");
    expect(resources).not.toContain("domains:");
    expect(webTool).not.toContain("include_domains");
    expect(orchestrator).not.toContain("resourceSubjectDomains");
    expect(orchestrator).not.toMatch(/khanacademy|openstax|stanford|harvard|ocw\.mit/i);
  });

  it("retrieves a broad web pool from Tavily and Brave and excludes Wikipedia/Wikimedia", () => {
    expect(webTool).toContain("TAVILY_API_KEY");
    expect(webTool).toContain("BRAVE_SEARCH_API_KEY");
    expect(webTool).toContain("api.tavily.com/search");
    expect(webTool).toContain("api.search.brave.com/res/v1/web/search");
    expect(webTool).toContain("X-Subscription-Token");
    expect(webTool).toContain("wikipedia\\.org|wikimedia\\.org");
  });

  it("retrieves scholarly candidates across Crossref, OpenAlex, and Semantic Scholar", () => {
    expect(academicTool).toContain("api.crossref.org/works");
    expect(academicTool).toContain("api.openalex.org/works");
    expect(academicTool).toContain("api.semanticscholar.org/graph/v1/paper/search");
    expect(academicTool).toContain("SEMANTIC_SCHOLAR_API_KEY");
    expect(academicTool).toContain("OPENALEX_API_KEY");
  });

  it("selects resources from retrieved candidate IDs using relevance, credibility, learner fit, difficulty, and diversity", () => {
    expect(resourceAgent).toContain("candidateId");
    expect(resourceAgent).toContain("SELECTION, not URL generation");
    expect(resourceAgent).toContain("Source-neutrality rule");
    expect(resourceAgent).toContain("Learner fit");
    expect(resourceAgent).toContain("Difficulty and task fit");
    expect(resourceAgent).toContain("Diversity");
    expect(orchestrator).toContain("relevanceScore");
    expect(orchestrator).toContain("credibilityScore");
    expect(orchestrator).toContain("audienceFitScore");
    expect(orchestrator).toContain("resourceTypeFit");
    expect(orchestrator).toContain("deterministicResourceSelection");
    expect(orchestrator).toContain("enforceResourceMix");
    expect(orchestrator).toContain("distinctHosts");
    expect(resourceStrategy).toContain("maxPapers");
    expect(resourceStrategy).toContain("academicSearch");
    expect(resourceStrategy).toContain("implementationSignal");
    expect(resourceAgent).toContain("higher difficulty with research papers");
  });

  it("minimizes resource API traffic without sacrificing adaptive selection", () => {
    expect(orchestrator).toContain("One high-signal web query per node");
    expect(orchestrator).toContain("queries.slice(0, 2)");
    expect(orchestrator).toContain("findResourcesBatch");
    expect(webTool).toContain("Rotate the primary provider by query");
    expect(academicTool).toContain("Use one index normally");
    expect(apiSchema).toContain("nodes: z.array(ResourceNodeContextSchema).min(1).max(20)");
    expect(resourceRequestBlock).not.toContain("documents:");
    expect(orchestrator).toContain("RESOURCE_CACHE_TTL_MS");
    expect(orchestrator).toContain("const concurrency = 2");
    expect(webTool).toContain("Only fall back when the first source");
    expect(academicTool).toContain("touch another index only when the first one fails");
  });

});
