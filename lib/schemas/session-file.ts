import { z } from "zod";
import { ConceptEdgeSchema, ConceptNodeSchema, GraphLevelDescriptorSchema } from "./concept";
import { ExtractedDocumentSchema } from "./documents";
import { LearnerProfileSchema, LearningPathProposalSchema } from "./learning-path";

export const PrimaryModeSchema = z.enum(["tree", "brick"]);
export const TreeIntentSchema = z.enum(["decompose", "trace-prerequisites", "analyze-question"]);
export const BrickIntentSchema = z.enum(["explore", "destination"]);

const TraceEventSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  agent: z.string().optional(),
  type: z.enum([
    "agent_start",
    "model_call",
    "tool_call",
    "tool_result",
    "handoff",
    "validation",
    "revision",
    "agent_finish",
    "error",
  ]),
  summary: z.string(),
  durationMs: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const AdaptiveExplanationSchema = z.object({
  explanation: z.string(),
  sourceSummary: z.string().optional(),
  example: z.string(),
  keyTakeaway: z.string(),
  evidence: z.array(z.object({
    documentId: z.string(),
    sectionId: z.string(),
    page: z.number().int().positive().optional(),
    heading: z.string().optional(),
  })).optional(),
});

export const PortableWorkspaceStateSchema = z.object({
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(300),
  mode: PrimaryModeSchema,
  treeIntent: TreeIntentSchema,
  brickIntent: BrickIntentSchema,
  topic: z.string().max(300),
  knownInput: z.string().max(12_000),
  goal: z.string().max(700),
  nodes: z.array(ConceptNodeSchema).max(1200),
  edges: z.array(ConceptEdgeSchema).max(3000),
  levels: z.array(GraphLevelDescriptorSchema).max(40),
  expandedNodeIds: z.array(z.string()).max(1200),
  selectedNodeId: z.string().optional(),
  focusedNodeId: z.string().optional(),
  viewRootId: z.string().optional(),
  learningPath: LearningPathProposalSchema.optional(),
  trace: z.array(TraceEventSchema).max(150),
  explanations: z.record(z.string(), AdaptiveExplanationSchema).default({}),
  createdAt: z.number().int().nonnegative(),
});
export type PortableWorkspaceState = z.infer<typeof PortableWorkspaceStateSchema>;

export const PortableSessionStateSchema = z.object({
  mode: PrimaryModeSchema,
  treeIntent: TreeIntentSchema,
  brickIntent: BrickIntentSchema,
  nodes: z.array(ConceptNodeSchema).max(1200),
  edges: z.array(ConceptEdgeSchema).max(3000),
  levels: z.array(GraphLevelDescriptorSchema).max(40),
  expandedNodeIds: z.array(z.string()).max(1200),
  selectedNodeId: z.string().optional(),
  focusedNodeId: z.string().optional(),
  viewRootId: z.string().optional(),
  goal: z.string().max(700),
  knownInput: z.string().max(12_000),
  topic: z.string().max(300),
  profile: LearnerProfileSchema,
  documents: z.array(ExtractedDocumentSchema).max(6),
  learningPath: LearningPathProposalSchema.optional(),
  trace: z.array(TraceEventSchema).max(150),
  explanations: z.record(z.string(), AdaptiveExplanationSchema).default({}),
  workspaces: z.array(PortableWorkspaceStateSchema).max(40).default([]),
  activeWorkspaceId: z.string().optional(),
});
export type PortableSessionState = z.infer<typeof PortableSessionStateSchema>;

export const PortableSessionFileSchema = z.object({
  format: z.literal("brick-tree-session"),
  version: z.literal(1),
  app: z.literal("Brick Tree"),
  exportedAt: z.string().datetime(),
  state: PortableSessionStateSchema,
});
export type PortableSessionFile = z.infer<typeof PortableSessionFileSchema>;

export function createPortableSessionFile(state: PortableSessionState): PortableSessionFile {
  return PortableSessionFileSchema.parse({
    format: "brick-tree-session",
    version: 1,
    app: "Brick Tree",
    exportedAt: new Date().toISOString(),
    state,
  });
}

export function parsePortableSessionFile(value: unknown): PortableSessionFile {
  return PortableSessionFileSchema.parse(value);
}

export function safeSessionFileName(topic: string): string {
  const slug = topic
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "brick-tree-session"}.bricktree.json`;
}
