import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigateTree: vi.fn(),
  discoverLearningPath: vi.fn(),
  branchFromConcept: vi.fn(),
  explainConcept: vi.fn(),
  findResources: vi.fn(),
}));

vi.mock("@/lib/agents/orchestrator", () => ({
  ...mocks,
  publicAgentList: () => [],
}));

describe("POST /api/agent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.navigateTree.mockResolvedValue({ data: { marker: "tree" }, trace: [], warnings: [] });
    mocks.discoverLearningPath.mockResolvedValue({ data: { marker: "brick" }, trace: [], warnings: [] });
  });

  it("rejects invalid requests before running an agent", async () => {
    const { POST } = await import("@/app/api/agent/route");
    const response = await POST(new Request("http://localhost/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "navigate", traversal: { mode: "tree", intent: "decompose" }, topic: "" }),
    }));
    expect(response.status).toBe(400);
    expect(mocks.navigateTree).not.toHaveBeenCalled();
  });

  it("routes Tree Break Down through the shared navigate endpoint", async () => {
    const { POST } = await import("@/app/api/agent/route");
    const response = await POST(new Request("http://localhost/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "navigate", traversal: { mode: "tree", intent: "decompose" }, topic: "Calculus" }),
    }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.data.marker).toBe("tree");
    expect(mocks.navigateTree).toHaveBeenCalledWith(expect.objectContaining({ intent: "decompose", topic: "Calculus" }));
  });

  it("routes Brick Explore without requiring a destination", async () => {
    const { POST } = await import("@/app/api/agent/route");
    const response = await POST(new Request("http://localhost/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "navigate",
        traversal: { mode: "brick", intent: "explore" },
        knownConcepts: ["Algebra", "Python"],
      }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.discoverLearningPath).toHaveBeenCalledWith(expect.objectContaining({ intent: "explore", goal: undefined }));
  });

  it("routes Tree Trace to Roots as a distinct shared-graph intent", async () => {
    const { POST } = await import("@/app/api/agent/route");
    const response = await POST(new Request("http://localhost/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "navigate", traversal: { mode: "tree", intent: "trace-prerequisites" }, topic: "Backpropagation" }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.navigateTree).toHaveBeenCalledWith(expect.objectContaining({ intent: "trace-prerequisites", topic: "Backpropagation" }));
  });


  it("routes Tree Analyze a Question as a distinct shared-graph intent", async () => {
    const { POST } = await import("@/app/api/agent/route");
    const response = await POST(new Request("http://localhost/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "navigate",
        traversal: { mode: "tree", intent: "analyze-question" },
        topic: "How do I stay valuable as a software engineer in an AI-heavy future?",
      }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.navigateTree).toHaveBeenCalledWith(expect.objectContaining({
      intent: "analyze-question",
      topic: "How do I stay valuable as a software engineer in an AI-heavy future?",
    }));
  });

  it("requires a goal for Brick Destination", async () => {
    const { POST } = await import("@/app/api/agent/route");
    const response = await POST(new Request("http://localhost/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "navigate", traversal: { mode: "brick", intent: "destination" }, knownConcepts: ["Algebra"] }),
    }));
    expect(response.status).toBe(400);
    expect(mocks.discoverLearningPath).not.toHaveBeenCalled();
  });

  it("rejects an oversized body even when Content-Length is unavailable", async () => {
    const { POST } = await import("@/app/api/agent/route");
    const oversized = JSON.stringify({
      action: "navigate",
      traversal: { mode: "tree", intent: "decompose" },
      topic: "Calculus",
      padding: "x".repeat(3_500_000),
    });
    const response = await POST(new Request("http://localhost/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: oversized,
    }));
    expect(response.status).toBe(413);
    expect(mocks.navigateTree).not.toHaveBeenCalled();
  });

  it("returns a clean 429 when every available provider is rate-limited", async () => {
    const { LLMResponseError } = await import("@/lib/llm/provider");
    mocks.navigateTree.mockRejectedValueOnce(new LLMResponseError("groq is rate-limited or out of quota.", {
      kind: "rate_limit",
      status: 429,
      retryAfterMs: 12_000,
    }));
    const { POST } = await import("@/app/api/agent/route");
    const response = await POST(new Request("http://localhost/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "navigate", traversal: { mode: "tree", intent: "decompose" }, topic: "Calculus" }),
    }));
    expect(response.status).toBe(429);
    const payload = await response.json();
    expect(payload.error.code).toBe("provider_rate_limited");
    expect(payload.error.message).not.toContain("API_KEY");
  });

});
