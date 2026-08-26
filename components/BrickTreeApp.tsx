"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ConceptEdge, ConceptNode, GraphLevelDescriptor, ResourceLink } from "@/lib/schemas/concept";
import type { ExtractedDocument } from "@/lib/schemas/documents";
import type { LearnerProfile as LearnerProfileType, LearningPathProposal } from "@/lib/schemas/learning-path";
import type { BrickIntent, LearningTraversal, TreeIntent } from "@/lib/schemas/session";
import type { PedagogyValidation } from "@/lib/schemas/validation";
import type { ExplanationLevel } from "@/lib/schemas/api";
import type { AgentTraceEvent } from "@/lib/observability/trace";
import { callAgent } from "@/lib/utils/api-client";
import { graphContextFromState } from "@/lib/graph/graph-utils";
import {
  hasGeneratedTraversalNeighbors,
  mergeGraphPatch,
  traversalRelationships,
} from "@/lib/graph/client-state";
import type { AdaptiveExplanation } from "@/components/node/NodeDetailPanel";
import { LearnerProfile } from "@/components/learning/LearnerProfile";
import { DocumentSources } from "@/components/learning/DocumentSources";
import { SessionTransfer } from "@/components/session/SessionTransfer";
import { normalizeConceptTitle } from "@/lib/utils/text";
import {
  createPortableSessionFile,
  parsePortableSessionFile,
  safeSessionFileName,
  type PortableSessionState,
} from "@/lib/schemas/session-file";
import styles from "./BrickTreeApp.module.css";

type PrimaryMode = "tree" | "brick";
type ExperiencePhase = "landing" | "workspace";

type TreeData = {
  root?: ConceptNode;
  parent: ConceptNode;
  nodes: ConceptNode[];
  edges: ConceptEdge[];
  level: GraphLevelDescriptor;
  validation?: PedagogyValidation;
  summary: string;
  stoppedAtKnown?: boolean;
};

type BrickData = {
  root?: ConceptNode;
  parent?: ConceptNode;
  nodes: ConceptNode[];
  edges: ConceptEdge[];
  level: GraphLevelDescriptor;
  learningPath: LearningPathProposal;
  validation: PedagogyValidation;
};

type ResourceData = { resources: ResourceLink[]; summary: string };

type WorkspaceSnapshot = {
  id: string;
  name: string;
  mode: PrimaryMode;
  treeIntent: TreeIntent;
  brickIntent: BrickIntent;
  topic: string;
  knownInput: string;
  goal: string;
  nodes: ConceptNode[];
  edges: ConceptEdge[];
  levels: GraphLevelDescriptor[];
  expandedNodeIds: string[];
  selectedNodeId?: string;
  focusedNodeId?: string;
  viewRootId?: string;
  learningPath?: LearningPathProposal;
  trace: AgentTraceEvent[];
  explanations: Record<string, AdaptiveExplanation>;
  createdAt: number;
};

const TREE_INTENT_COPY: Record<
  TreeIntent,
  { title: string; prompt: string; placeholder: string; action: string; busy: string }
> = {
  decompose: {
    title: "Cut down",
    prompt: "What do you want to cut down?",
    placeholder: "Machine learning",
    action: "Cut into branches",
    busy: "Cutting the idea into useful parts…",
  },
  "trace-prerequisites": {
    title: "Trace roots",
    prompt: "What do you want to understand from the ground up?",
    placeholder: "Backpropagation",
    action: "Trace roots",
    busy: "Tracing the foundations underneath it…",
  },
  "analyze-question": {
    title: "Analyze a question",
    prompt: "What question do you want to unpack?",
    placeholder: "How do I stay valuable as a software engineer as AI improves?",
    action: "Map the question",
    busy: "Separating the question into useful lenses…",
  },
};

const DEFAULT_PROFILE: LearnerProfileType = {
  existingKnowledge: [],
  sourceMode: "general",
  sourceDocumentIds: [],
  knowledgeLevel: "beginner",
  languageStyle: "standard",
  depthPreference: "balanced",
  purpose: "general-learning",
};

function uniqueLevels(levels: GraphLevelDescriptor[]): GraphLevelDescriptor[] {
  const map = new Map<string, GraphLevelDescriptor>();
  for (const level of levels) map.set(`${level.axis}:${level.index}`, level);
  return [...map.values()].sort((a, b) => a.index - b.index);
}

function parseKnownConcepts(input: string): string[] {
  return [...new Set(input.split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean))].slice(0, 60);
}

function migrateNode(node: ConceptNode): ConceptNode {
  return {
    ...node,
    knowledgeStatus: node.knowledgeStatus ?? "available",
    origins: node.origins ?? [{ type: "model-knowledge" }],
  };
}

function explanationLevel(profile: LearnerProfileType): ExplanationLevel {
  const level = profile.knowledgeLevel ?? "beginner";
  return level === "novice" ? "simple" : level;
}

function modeAxis(mode: PrimaryMode): "Depth" | "Height" {
  return mode === "tree" ? "Depth" : "Height";
}

function levelLabel(mode: PrimaryMode, level: number): string {
  if (mode === "tree") return `Depth ${level}`;
  return `Height ${level > 0 ? `+${level}` : level}`;
}

function statusText(status: ConceptNode["knowledgeStatus"]): string {
  switch (status) {
    case "known": return "Known";
    case "recommended": return "Recommended";
    case "future": return "Future";
    case "missing-prerequisite": return "Missing foundation";
    default: return "Available";
  }
}

export function BrickTreeApp() {
  const [phase, setPhase] = useState<ExperiencePhase>("landing");
  const [mode, setMode] = useState<PrimaryMode>("tree");
  const [workspaces, setWorkspaces] = useState<WorkspaceSnapshot[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>();
  const [treeIntent, setTreeIntent] = useState<TreeIntent>("decompose");
  const [brickIntent, setBrickIntent] = useState<BrickIntent>("explore");
  const [topic, setTopic] = useState("Machine Learning");
  const [knownInput, setKnownInput] = useState("Algebra, basic statistics, Python");
  const [goal, setGoal] = useState("");
  const [profile, setProfile] = useState<LearnerProfileType>(DEFAULT_PROFILE);
  const [documents, setDocuments] = useState<ExtractedDocument[]>([]);
  const [nodes, setNodes] = useState<ConceptNode[]>([]);
  const [edges, setEdges] = useState<ConceptEdge[]>([]);
  const [levels, setLevels] = useState<GraphLevelDescriptor[]>([]);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [focusedNodeId, setFocusedNodeId] = useState<string>();
  const [viewRootId, setViewRootId] = useState<string>();
  const [learningPath, setLearningPath] = useState<LearningPathProposal>();
  const [trace, setTrace] = useState<AgentTraceEvent[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [busyLabel, setBusyLabel] = useState<string>();
  const [loadingNodeId, setLoadingNodeId] = useState<string>();
  const [resourceLoadingNodeId, setResourceLoadingNodeId] = useState<string>();
  const [explanationLoadingNodeId, setExplanationLoadingNodeId] = useState<string>();
  const [explanations, setExplanations] = useState<Record<string, AdaptiveExplanation>>({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  useEffect(() => {
    const known = new Set(parseKnownConcepts(knownInput).map(normalizeConceptTitle));
    if (!known.size) return;
    setNodes((current) => {
      let changed = false;
      const next = current.map((node) => {
        if (!known.has(node.normalizedTitle) || node.knowledgeStatus === "known") return node;
        changed = true;
        return { ...node, knowledgeStatus: "known" as const };
      });
      return changed ? next : current;
    });
  }, [knownInput]);

  const traversal = useMemo<LearningTraversal>(() => (
    mode === "tree"
      ? { mode: "tree", intent: treeIntent }
      : { mode: "brick", intent: brickIntent }
  ), [mode, treeIntent, brickIntent]);

  const activeRelationships = useMemo(() => traversalRelationships(traversal), [traversal]);
  const generatedNodeIds = useMemo(
    () => new Set(
      edges
        .filter((edge) => activeRelationships.has(edge.relationshipType))
        .map((edge) => edge.source),
    ),
    [edges, activeRelationships],
  );

  const rootNode = useMemo(
    () => nodes.find((node) => !node.parentId),
    [nodes],
  );
  const baseDepth = rootNode?.depth ?? 0;

  const mapNodes = useMemo(() => nodes
    .filter((node) => !(mode === "brick" && node.id === rootNode?.id && node.title === "Your Foundations"))
    .sort((a, b) => a.depth - b.depth || a.title.localeCompare(b.title)), [nodes, mode, rootNode?.id]);

  const focusNode = useMemo(() => {
    const requested = focusedNodeId ?? selectedNodeId;
    const requestedNode = requested ? nodes.find((node) => node.id === requested) : undefined;
    if (mode === "brick" && requestedNode?.id === rootNode?.id && requestedNode.title === "Your Foundations") return undefined;
    return requestedNode ?? (mode === "tree" ? rootNode : undefined);
  }, [focusedNodeId, selectedNodeId, nodes, mode, rootNode]);

  const focusChildren = useMemo(() => {
    if (!focusNode) return [];
    const childIds = edges
      .filter((edge) => edge.source === focusNode.id && activeRelationships.has(edge.relationshipType))
      .map((edge) => edge.target);
    const childSet = new Set(childIds);
    return nodes.filter((node) => childSet.has(node.id)).sort((a, b) => a.title.localeCompare(b.title));
  }, [focusNode, edges, activeRelationships, nodes]);

  const focusParent = useMemo(() => {
    if (!focusNode) return undefined;
    const incoming = edges.find((edge) => edge.target === focusNode.id && activeRelationships.has(edge.relationshipType));
    if (incoming) return nodes.find((node) => node.id === incoming.source);
    return focusNode.parentId ? nodes.find((node) => node.id === focusNode.parentId) : undefined;
  }, [focusNode, edges, activeRelationships, nodes]);

  const brickFoundations = useMemo(() => {
    if (mode !== "brick" || !rootNode) return [];
    return nodes
      .filter((node) => node.parentId === rootNode.id && node.depth === 0)
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [mode, rootNode, nodes]);

  const brickFirstLayer = useMemo(() => {
    if (mode !== "brick") return [];
    const foundationIds = new Set(brickFoundations.map((node) => node.id));
    const targetIds = new Set(edges.filter((edge) => foundationIds.has(edge.source)).map((edge) => edge.target));
    return nodes.filter((node) => targetIds.has(node.id)).sort((a, b) => a.title.localeCompare(b.title));
  }, [mode, brickFoundations, edges, nodes]);

  const nodeLevel = useCallback((node: ConceptNode) => {
    const offset = Math.max(0, node.depth - baseDepth);
    return mode === "tree" ? -offset : offset;
  }, [baseDepth, mode]);

  const availableLevels = useMemo(() => [...new Set(mapNodes.map((node) => nodeLevel(node)))].sort((a, b) => mode === "tree" ? b - a : a - b), [mapNodes, nodeLevel, mode]);

  const agentDocuments = useMemo(() => {
    if ((profile.sourceMode ?? "general") === "general") return undefined;
    const selected = new Set(profile.sourceDocumentIds ?? []);
    const active = documents.filter((document) => selected.has(document.id));
    return active.length ? active : undefined;
  }, [documents, profile.sourceMode, profile.sourceDocumentIds]);

  const syncedProfile = useCallback((
    known = parseKnownConcepts(knownInput),
    options: { includeGoal?: boolean } = {},
  ): LearnerProfileType => {
    const activeDestination = options.includeGoal && goal.trim() ? goal.trim() : undefined;
    const availableDocumentIds = new Set(documents.map((document) => document.id));
    return {
      ...profile,
      existingKnowledge: known,
      goal: activeDestination,
      learningGoal: profile.learningGoal?.trim() || undefined,
      sourceDocumentIds: (profile.sourceDocumentIds ?? []).filter((id) => availableDocumentIds.has(id)),
    };
  }, [profile, knownInput, goal, documents]);

  const beginRequest = useCallback((label: string) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setBusyLabel(label);
    setError(undefined);
    setWarnings([]);
    return controller;
  }, []);

  const endRequest = useCallback(() => {
    setBusyLabel(undefined);
    requestRef.current = null;
  }, []);

  const workspaceName = useCallback((workspaceMode = mode) => {
    const rootTitle = nodes.find((node) => !node.parentId)?.title;
    if (rootTitle && rootTitle !== "Your Foundations") return rootTitle;
    if (workspaceMode === "brick") return goal.trim() || parseKnownConcepts(knownInput).slice(0, 2).join(" + ") || "New Brick";
    return topic.trim() || "New Tree";
  }, [mode, nodes, goal, knownInput, topic]);

  const applyWorkspace = useCallback((workspace: WorkspaceSnapshot) => {
    requestRef.current?.abort();
    setActiveWorkspaceId(workspace.id);
    setMode(workspace.mode);
    setTreeIntent(workspace.treeIntent);
    setBrickIntent(workspace.brickIntent);
    setTopic(workspace.topic);
    setKnownInput(workspace.knownInput);
    setGoal(workspace.goal);
    setNodes(workspace.nodes.map(migrateNode));
    setEdges(workspace.edges);
    setLevels(workspace.levels);
    setExpandedNodeIds(new Set(workspace.expandedNodeIds));
    setSelectedNodeId(workspace.selectedNodeId);
    setFocusedNodeId(workspace.focusedNodeId);
    setViewRootId(workspace.viewRootId);
    setLearningPath(workspace.learningPath);
    setTrace(workspace.trace);
    setExplanations(workspace.explanations);
    setWarnings([]);
    setError(undefined);
  }, []);

  const createWorkspace = useCallback((nextMode: PrimaryMode, seed?: { topic?: string; knownInput?: string; goal?: string }) => {
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const workspace: WorkspaceSnapshot = {
      id,
      name: nextMode === "tree" ? seed?.topic || "New Tree" : seed?.goal || seed?.knownInput || "New Brick",
      mode: nextMode,
      treeIntent: "decompose",
      brickIntent: seed?.goal ? "destination" : "explore",
      topic: seed?.topic ?? (nextMode === "tree" ? "Machine Learning" : ""),
      knownInput: seed?.knownInput ?? (nextMode === "brick" ? "Algebra, basic statistics, Python" : ""),
      goal: seed?.goal ?? "",
      nodes: [],
      edges: [],
      levels: [],
      expandedNodeIds: [],
      trace: [],
      explanations: {},
      createdAt: Date.now(),
    };
    setWorkspaces((current) => [...current, workspace]);
    applyWorkspace(workspace);
    setPhase("workspace");
    setDrawerOpen(false);
  }, [applyWorkspace]);

  const switchWorkspace = useCallback((id: string) => {
    const workspace = workspaces.find((item) => item.id === id);
    if (!workspace) return;
    applyWorkspace(workspace);
    setDrawerOpen(false);
  }, [workspaces, applyWorkspace]);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    setWorkspaces((current) => current.map((workspace) => workspace.id === activeWorkspaceId ? {
      ...workspace,
      name: workspaceName(mode),
      mode,
      treeIntent,
      brickIntent,
      topic,
      knownInput,
      goal,
      nodes,
      edges,
      levels,
      expandedNodeIds: [...expandedNodeIds],
      selectedNodeId,
      focusedNodeId,
      viewRootId,
      learningPath,
      trace: trace.slice(-100),
      explanations,
    } : workspace));
  }, [activeWorkspaceId, workspaceName, mode, treeIntent, brickIntent, topic, knownInput, goal, nodes, edges, levels, expandedNodeIds, selectedNodeId, focusedNodeId, viewRootId, learningPath, trace, explanations]);

  const switchMode = useCallback((nextMode: PrimaryMode) => {
    if (nextMode === mode) return;
    const existing = [...workspaces].reverse().find((workspace) => workspace.mode === nextMode);
    if (existing) {
      applyWorkspace(existing);
      return;
    }
    createWorkspace(nextMode);
  }, [mode, workspaces, applyWorkspace, createWorkspace]);

  async function generateInitial(event?: FormEvent) {
    event?.preventDefault();
    const label = mode === "tree"
      ? TREE_INTENT_COPY[treeIntent].busy
      : brickIntent === "explore"
        ? "Finding realistic next bricks…"
        : "Finding the next bricks toward your destination…";
    const controller = beginRequest(label);
    try {
      const knownConcepts = parseKnownConcepts(knownInput);
      const nextProfile = syncedProfile(knownConcepts, { includeGoal: mode === "brick" && brickIntent === "destination" });
      setProfile(nextProfile);

      if (mode === "tree") {
        if (topic.trim().length < 2) throw new Error(treeIntent === "analyze-question" ? "Enter a question first." : "Enter a concept first.");
        const response = await callAgent<TreeData>({
          action: "navigate",
          traversal,
          topic: topic.trim(),
          learnerProfile: nextProfile,
          documents: agentDocuments,
        }, controller.signal);
        const root = response.data?.root ?? response.data?.parent;
        if (!response.data || !root) throw new Error("Brick Tree returned no concept map.");
        const migratedRoot = migrateNode(root);
        setNodes([migratedRoot, ...response.data.nodes.map(migrateNode)]);
        setEdges(response.data.edges);
        setLevels(uniqueLevels([root.level, response.data.level]));
        setExpandedNodeIds(new Set([root.id]));
        setSelectedNodeId(root.id);
        setFocusedNodeId(root.id);
        setViewRootId(root.id);
        setLearningPath(undefined);
        setTrace(response.trace as AgentTraceEvent[]);
        setWarnings(response.warnings);
      } else {
        if (!knownConcepts.length) throw new Error("Add at least one thing you already know.");
        if (brickIntent === "destination" && !goal.trim()) throw new Error("Add a destination first.");
        const response = await callAgent<BrickData>({
          action: "navigate",
          traversal,
          knownConcepts,
          goal: brickIntent === "destination" ? goal.trim() : undefined,
          learnerProfile: nextProfile,
          documents: agentDocuments,
        }, controller.signal);
        if (!response.data?.root) throw new Error("Brick Tree returned no learning path.");
        const root = migrateNode(response.data.root);
        setNodes([root, ...response.data.nodes.map(migrateNode)]);
        setEdges(response.data.edges);
        setLevels(uniqueLevels([root.level, response.data.level]));
        setExpandedNodeIds(new Set([root.id]));
        setSelectedNodeId(root.id);
        setFocusedNodeId(root.id);
        setViewRootId(root.id);
        setLearningPath(response.data.learningPath);
        setTrace(response.trace as AgentTraceEvent[]);
        setWarnings(response.warnings);
      }
      setExplanations({});
    } catch (requestError) {
      if ((requestError as Error).name !== "AbortError") setError((requestError as Error).message);
    } finally {
      endRequest();
    }
  }

  const hasGeneratedFor = useCallback(
    (nodeId: string, nextTraversal: LearningTraversal) => hasGeneratedTraversalNeighbors(nodeId, edges, nextTraversal),
    [edges],
  );

  const expandNodeWithTraversal = useCallback(async (nodeId: string, nextTraversal: LearningTraversal) => {
    const node = nodes.find((item) => item.id === nodeId);
    if (!node) return;

    if (hasGeneratedFor(nodeId, nextTraversal)) {
      setExpandedNodeIds((current) => new Set([...current, nodeId]));
      setFocusedNodeId(nodeId);
      return;
    }

    if (nextTraversal.mode === "tree" && nextTraversal.intent === "trace-prerequisites" && node.knowledgeStatus === "known") {
      setWarnings([`You already marked ${node.title} as understood. Tree can stop at this starting point, or you can switch to Brick and build from it.`]);
      return;
    }

    const controller = beginRequest(
      nextTraversal.mode === "tree"
        ? nextTraversal.intent === "decompose"
          ? `Cutting ${node.title} into smaller parts…`
          : nextTraversal.intent === "analyze-question"
            ? `Opening another lens on ${node.title}…`
            : `Tracing what sits underneath ${node.title}…`
        : `Building outward from ${node.title}…`,
    );
    setLoadingNodeId(nodeId);
    try {
      const nextProfile = syncedProfile(undefined, { includeGoal: nextTraversal.mode === "brick" && nextTraversal.intent === "destination" });
      const response = await callAgent<TreeData | BrickData>({
        action: "navigate",
        traversal: nextTraversal,
        node,
        graphContext: graphContextFromState(nodes, levels, nodeId),
        goal: nextTraversal.mode === "brick" && nextTraversal.intent === "destination" ? goal.trim() || undefined : undefined,
        learnerProfile: nextProfile,
        documents: agentDocuments,
      }, controller.signal);
      if (!response.data) throw new Error("No graph update returned.");

      const data = response.data;
      const parent = migrateNode(("parent" in data && data.parent) ? data.parent : node);
      const patch = mergeGraphPatch(nodes, edges, parent, data.nodes.map(migrateNode), data.edges);
      setNodes(patch.nodes);
      setEdges(patch.edges);
      setLevels((current) => uniqueLevels([...current, data.level]));
      setExpandedNodeIds((current) => new Set([...current, nodeId]));
      setFocusedNodeId(nodeId);
      if ("learningPath" in data) setLearningPath(data.learningPath);
      setTrace((current) => [...current, ...(response.trace as AgentTraceEvent[])].slice(-100));
      setWarnings(response.warnings);
    } catch (requestError) {
      if ((requestError as Error).name !== "AbortError") setError((requestError as Error).message);
    } finally {
      setLoadingNodeId(undefined);
      endRequest();
    }
  }, [nodes, edges, levels, goal, agentDocuments, beginRequest, endRequest, hasGeneratedFor, syncedProfile]);

  const expandNode = useCallback(
    (nodeId: string) => expandNodeWithTraversal(nodeId, traversal),
    [expandNodeWithTraversal, traversal],
  );

  async function explainNode(nodeId: string, level: ExplanationLevel) {
    const node = nodes.find((item) => item.id === nodeId);
    if (!node || explanations[nodeId]) return;
    setExplanationLoadingNodeId(nodeId);
    setError(undefined);
    try {
      const response = await callAgent<AdaptiveExplanation>({
        action: "explain",
        node,
        level,
        learnerProfile: syncedProfile(undefined, { includeGoal: mode === "brick" && brickIntent === "destination" }),
        documents: agentDocuments,
      });
      if (!response.data) throw new Error("No explanation returned.");
      setExplanations((current) => ({ ...current, [node.id]: response.data! }));
      setTrace((current) => [...current, ...(response.trace as AgentTraceEvent[])].slice(-100));
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setExplanationLoadingNodeId(undefined);
    }
  }

  async function findResources(nodeId: string) {
    const node = nodes.find((item) => item.id === nodeId);
    if (!node) return;
    setResourceLoadingNodeId(nodeId);
    setError(undefined);
    try {
      const response = await callAgent<ResourceData>({
        action: "resources",
        node,
        learnerProfile: syncedProfile(undefined, { includeGoal: mode === "brick" && brickIntent === "destination" }),
        documents: agentDocuments,
      });
      if (!response.data) throw new Error("No resources returned.");
      setNodes((current) => current.map((item) => item.id === nodeId ? { ...item, resources: response.data!.resources } : item));
      setTrace((current) => [...current, ...(response.trace as AgentTraceEvent[])].slice(-100));
      setWarnings(response.warnings);
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setResourceLoadingNodeId(undefined);
    }
  }

  function selectNode(nodeId: string, loadExplanation = false) {
    setSelectedNodeId(nodeId);
    setFocusedNodeId(nodeId);
    if (loadExplanation && !explanations[nodeId]) void explainNode(nodeId, explanationLevel(profile));
  }

  function teleportNode(nodeId: string) {
    selectNode(nodeId, false);
    setDrawerOpen(false);
  }

  function selectLevel(level: number) {
    const node = mapNodes.find((item) => nodeLevel(item) === level);
    if (node) teleportNode(node.id);
  }

  function markKnown(nodeId: string) {
    const node = nodes.find((item) => item.id === nodeId);
    if (!node) return;
    setNodes((current) => current.map((item) => item.id === nodeId ? { ...item, knowledgeStatus: "known" } : item));
    setProfile((current) => ({
      ...current,
      existingKnowledge: [...new Set([...current.existingKnowledge, node.title])],
    }));
    const known = parseKnownConcepts(knownInput);
    if (!known.some((item) => normalizeConceptTitle(item) === node.normalizedTitle)) {
      setKnownInput([...known, node.title].join(", "));
    }
  }

  function branchFromNode(nodeId: string, nextMode: PrimaryMode) {
    const node = nodes.find((item) => item.id === nodeId);
    if (!node) return;
    if (nextMode === "tree") {
      createWorkspace("tree", { topic: node.title });
    } else {
      createWorkspace("brick", { knownInput: node.title });
    }
  }

  function addDocument(document: ExtractedDocument) {
    setDocuments((current) => [...current.filter((item) => item.id !== document.id), document].slice(-6));
    setProfile((current) => ({
      ...current,
      sourceDocumentIds: [...new Set([...current.sourceDocumentIds, document.id])].slice(-6),
      sourceMode: current.sourceMode === "general" ? "prefer-uploaded" : current.sourceMode,
    }));
  }

  function removeDocument(id: string) {
    setDocuments((current) => current.filter((document) => document.id !== id));
    setProfile((current) => ({ ...current, sourceDocumentIds: current.sourceDocumentIds.filter((documentId) => documentId !== id) }));
  }

  function toggleDocumentSource(id: string) {
    setProfile((current) => {
      const selected = new Set(current.sourceDocumentIds);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      return { ...current, sourceDocumentIds: [...selected].slice(-6) };
    });
  }

  function useDocumentAsTopic(document: ExtractedDocument) {
    setProfile((current) => ({
      ...current,
      sourceMode: "prefer-uploaded",
      sourceDocumentIds: [document.id],
      purpose: current.purpose === "general-learning" ? "research" : current.purpose,
    }));
    createWorkspace("tree", { topic: document.title || document.fileName });
    setWarnings([`Source ready: ${document.title}. Tree will prefer evidence from this file.`]);
  }

  function startNewGraph() {
    createWorkspace(mode);
  }

  const buildPortableState = useCallback((): PortableSessionState => ({
    mode,
    treeIntent,
    brickIntent,
    nodes,
    edges,
    levels,
    expandedNodeIds: [...expandedNodeIds],
    selectedNodeId,
    focusedNodeId,
    viewRootId,
    goal,
    knownInput,
    topic,
    profile,
    documents,
    learningPath,
    trace: trace.slice(-100),
    explanations,
    workspaces: workspaces.map((workspace) => ({ ...workspace, trace: workspace.trace.slice(-100) })),
    activeWorkspaceId,
  }), [mode, treeIntent, brickIntent, nodes, edges, levels, expandedNodeIds, selectedNodeId, focusedNodeId, viewRootId, goal, knownInput, topic, profile, documents, learningPath, trace, explanations, workspaces, activeWorkspaceId]);

  function downloadSession() {
    const session = createPortableSessionFile(buildPortableState());
    const blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = safeSessionFileName(rootNode?.title || topic || goal);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function uploadSession(file: File) {
    if (file.size > 12 * 1024 * 1024) throw new Error("Brick Tree session files are limited to 12 MB.");
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(await file.text());
    } catch {
      throw new Error("That file is not valid JSON.");
    }
    const saved = parsePortableSessionFile(parsedJson).state;
    requestRef.current?.abort();
    setProfile({ ...DEFAULT_PROFILE, ...saved.profile });
    setDocuments(saved.documents);
    const restoredWorkspaces: WorkspaceSnapshot[] = saved.workspaces.length
      ? saved.workspaces.map((workspace) => ({
          ...workspace,
          nodes: workspace.nodes.map(migrateNode),
          explanations: workspace.explanations as Record<string, AdaptiveExplanation>,
        }))
      : [{
          id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-restored`,
          name: saved.mode === "tree" ? saved.topic || "Restored Tree" : saved.goal || saved.knownInput || "Restored Brick",
          mode: saved.mode,
          treeIntent: saved.treeIntent,
          brickIntent: saved.brickIntent,
          topic: saved.topic,
          knownInput: saved.knownInput,
          goal: saved.goal,
          nodes: saved.nodes.map(migrateNode),
          edges: saved.edges,
          levels: saved.levels,
          expandedNodeIds: saved.expandedNodeIds,
          selectedNodeId: saved.selectedNodeId,
          focusedNodeId: saved.focusedNodeId,
          viewRootId: saved.viewRootId,
          learningPath: saved.learningPath,
          trace: saved.trace,
          explanations: saved.explanations as Record<string, AdaptiveExplanation>,
          createdAt: Date.now(),
        }];
    setWorkspaces(restoredWorkspaces);
    const restoredActive = restoredWorkspaces.find((workspace) => workspace.id === saved.activeWorkspaceId) ?? restoredWorkspaces[0];
    if (restoredActive) applyWorkspace(restoredActive);
    setError(undefined);
    setWarnings([`Restored ${file.name}.`]);
    setPhase("workspace");
  }



  if (phase === "landing") {
    return <Landing onBegin={(nextMode) => createWorkspace(nextMode)} />;
  }

  return (
    <main className={`${styles.experience} ${mode === "tree" ? styles.tree : styles.brick}`}>
      <button type="button" className={styles.homeButton} onClick={() => setPhase("landing")} aria-label="Brick Tree home">
        <BrandIcon />
      </button>

      <ModeDock mode={mode} onChange={switchMode} />

      <button type="button" className={styles.mapButton} onClick={() => setDrawerOpen((open) => !open)} aria-label="Open map">
        <span /><span /><span />
      </button>

      <AxisRail
        axis={modeAxis(mode)}
        levels={availableLevels}
        activeLevel={focusNode ? nodeLevel(focusNode) : 0}
        descriptors={levels}
        onSelect={selectLevel}
      />

      <div className={styles.hierarchyViewport}>
        {!nodes.length ? (
          <section className={`${styles.setupSection} ${mode === "brick" ? styles.setupBottom : styles.setupTop}`}>
            <SetupNode
              mode={mode}
              treeIntent={treeIntent}
              brickIntent={brickIntent}
              topic={topic}
              knownInput={knownInput}
              goal={goal}
              profile={profile}
              documents={documents}
              busyLabel={busyLabel}
              error={error}
              warnings={warnings}
              onModeChange={switchMode}
              onTreeIntentChange={setTreeIntent}
              onBrickIntentChange={setBrickIntent}
              onTopicChange={setTopic}
              onKnownInputChange={setKnownInput}
              onGoalChange={setGoal}
              onProfileChange={setProfile}
              onGenerate={(event) => void generateInitial(event)}
              onAddDocument={addDocument}
              onRemoveDocument={removeDocument}
              onToggleDocument={toggleDocumentSource}
              onUseDocumentAsTopic={useDocumentAsTopic}
              onDownload={downloadSession}
              onUpload={uploadSession}
              onDismissError={() => setError(undefined)}
              onDismissWarnings={() => setWarnings([])}
            />
          </section>
        ) : (
          <HierarchyStage
            key={`${activeWorkspaceId ?? "workspace"}:${focusNode?.id ?? "overview"}`}
            mode={mode}
            focusNode={focusNode}
            focusParent={focusParent}
            children={focusChildren}
            foundations={brickFoundations}
            firstBrickLayer={brickFirstLayer}
            learningPath={learningPath}
            goal={goal}
            selectedNodeId={selectedNodeId}
            generatedNodeIds={generatedNodeIds}
            explanations={explanations}
            loadingNodeId={loadingNodeId}
            resourceLoadingNodeId={resourceLoadingNodeId}
            explanationLoadingNodeId={explanationLoadingNodeId}
            busyLabel={busyLabel}
            error={error}
            warnings={warnings}
            onFocus={(id) => selectNode(id, false)}
            onBack={() => focusParent && teleportNode(focusParent.id)}
            onContinue={(id) => { selectNode(id, false); void expandNode(id); }}
            onExplain={(id) => void explainNode(id, explanationLevel(profile))}
            onFindResources={(id) => void findResources(id)}
            onMarkKnown={markKnown}
            onTreeFromHere={(id) => branchFromNode(id, "tree")}
            onBrickFromHere={(id) => branchFromNode(id, "brick")}
            onDismissMessages={() => { setError(undefined); setWarnings([]); }}
          />
        )}
      </div>

      <NavigatorDrawer
        open={drawerOpen}
        mode={mode}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        nodes={mapNodes}
        edges={edges}
        activeNodeId={focusNode?.id ?? selectedNodeId}
        learningPath={learningPath}
        goal={goal}
        hasSession={Boolean(workspaces.length || documents.length)}
        onClose={() => setDrawerOpen(false)}
        onSwitchWorkspace={switchWorkspace}
        onTeleport={teleportNode}
        onDownload={downloadSession}
        onNew={startNewGraph}
      />
    </main>
  );
}

function Landing({ onBegin }: { onBegin: (mode: PrimaryMode) => void }) {
  return (
    <main className={styles.landing}>
      <div className={styles.landingBackdrop} aria-hidden="true" />
      <div className={styles.landingBrand}><BrandIcon /><span>Brick Tree</span></div>
      <section className={styles.landingCopy}>
        <p className={styles.kicker}>One map. Two directions.</p>
        <h1>
          <span className={styles.treeText}>Cut down complex ideas</span>
          <span className={styles.bridgeText}> and </span>
          <span className={styles.brickText}>build up new ones.</span>
        </h1>
        <p className={styles.lead}>Start with a concept you do not understand, or start with what you already know. Brick Tree turns either one into a map you can move through one node at a time.</p>
      </section>

      <div className={styles.beginWrap}>
        <div className={styles.beginSplit}>
          <button type="button" className={styles.beginTree} onClick={() => onBegin("tree")}><small>Tree</small><span>Begin</span></button>
          <button type="button" className={styles.beginBrick} onClick={() => onBegin("brick")}><small>Brick</small><span>Begin</span></button>
        </div>
      </div>

      <section className={styles.landingFacts} aria-label="How Brick Tree works">
        <article><strong>Tree</strong><p>Cut a concept into useful branches, trace what comes before it, or unpack an open question.</p></article>
        <article><strong>Brick</strong><p>Start from known skills and surface realistic next concepts—or aim toward a destination.</p></article>
        <article><strong>Keep moving</strong><p>Open any node for detail and resources, then continue from that exact point.</p></article>
      </section>
    </main>
  );
}

function BrandIcon() {
  return <span className={styles.brandIcon} aria-hidden="true"><i /><i /><i /><b /></span>;
}

function ModeDock({ mode, onChange }: { mode: PrimaryMode; onChange: (mode: PrimaryMode) => void }) {
  return (
    <div className={styles.modeDock} aria-label="Switch between Tree and Brick">
      <button type="button" className={mode === "tree" ? styles.modeActive : ""} onClick={() => onChange("tree")}>Tree</button>
      <button type="button" className={mode === "brick" ? styles.modeActive : ""} onClick={() => onChange("brick")}>Brick</button>
    </div>
  );
}

function AxisRail({ axis, levels, activeLevel, descriptors, onSelect }: {
  axis: "Depth" | "Height";
  levels: number[];
  activeLevel: number;
  descriptors: GraphLevelDescriptor[];
  onSelect: (level: number) => void;
}) {
  const [openLevel, setOpenLevel] = useState<number>();
  const axisKey = axis === "Depth" ? "depth" : "height";
  const available = levels.length ? levels : [0];
  const descriptor = openLevel === undefined
    ? undefined
    : descriptors.find((item) => item.axis === axisKey && item.index === Math.abs(openLevel));

  return (
    <aside className={styles.axisRail} aria-label={`${axis} levels`}>
      <span>{axis}</span>
      <div>
        {available.map((level) => (
          <button
            key={level}
            type="button"
            className={activeLevel === level ? styles.axisActive : ""}
            onClick={() => {
              onSelect(level);
              setOpenLevel((current) => current === level ? undefined : level);
            }}
            aria-label={`${axis} ${level > 0 ? `+${level}` : level}`}
          >
            <i />{level > 0 ? `+${level}` : level}
          </button>
        ))}
      </div>
      {openLevel !== undefined ? (
        <div className={styles.axisPopover}>
          <strong>{axis} {openLevel > 0 ? `+${openLevel}` : openLevel}</strong>
          <p>{descriptor?.description || (openLevel === 0
            ? axis === "Depth"
              ? "Depth 0 is the concept or question you chose as the root of this Tree."
              : "Height 0 is the foundation knowledge you supplied to start this Brick map."
            : axis === "Depth"
              ? "One branch below the previous Tree layer. Each step cuts the focused idea into one directly understandable layer."
              : "One construction layer above the previous Brick layer. Each step adds only directly reachable knowledge.")}</p>
        </div>
      ) : null}
    </aside>
  );
}

function Buffer({ label }: { label?: string }) {
  return (
    <div className={styles.buffer} role="status" aria-live="polite">
      <div className={styles.bufferTrack}><i /><i /><i /><i /></div>
      <span>{label || "Agents are preparing the next layer…"}</span>
    </div>
  );
}

function HierarchyStage({
  mode,
  focusNode,
  focusParent,
  children,
  foundations,
  firstBrickLayer,
  learningPath,
  goal,
  selectedNodeId,
  generatedNodeIds,
  explanations,
  loadingNodeId,
  resourceLoadingNodeId,
  explanationLoadingNodeId,
  busyLabel,
  error,
  warnings,
  onFocus,
  onBack,
  onContinue,
  onExplain,
  onFindResources,
  onMarkKnown,
  onTreeFromHere,
  onBrickFromHere,
  onDismissMessages,
}: {
  mode: PrimaryMode;
  focusNode?: ConceptNode;
  focusParent?: ConceptNode;
  children: ConceptNode[];
  foundations: ConceptNode[];
  firstBrickLayer: ConceptNode[];
  learningPath?: LearningPathProposal;
  goal: string;
  selectedNodeId?: string;
  generatedNodeIds: Set<string>;
  explanations: Record<string, AdaptiveExplanation>;
  loadingNodeId?: string;
  resourceLoadingNodeId?: string;
  explanationLoadingNodeId?: string;
  busyLabel?: string;
  error?: string;
  warnings: string[];
  onFocus: (id: string) => void;
  onBack: () => void;
  onContinue: (id: string) => void;
  onExplain: (id: string) => void;
  onFindResources: (id: string) => void;
  onMarkKnown: (id: string) => void;
  onTreeFromHere: (id: string) => void;
  onBrickFromHere: (id: string) => void;
  onDismissMessages: () => void;
}) {
  const destination = mode === "brick" && learningPath?.estimatedDestinationHeight && goal.trim()
    ? {
        title: goal.trim(),
        height: learningPath.estimatedDestinationHeight,
        reason: learningPath.destinationHeightReason || "Estimated from the gap between your current foundation and the destination.",
      }
    : undefined;

  const focusLevel = focusNode ? (mode === "tree" ? -focusNode.depth : focusNode.depth) : 0;

  const renderCompactRow = (items: ConceptNode[], direction: "up" | "down") => (
    <div className={`${styles.compactRow} ${direction === "up" ? styles.rowUp : styles.rowDown}`}>
      {items.map((node, index) => (
        <CompactNode
          key={node.id}
          node={node}
          mode={mode}
          level={mode === "tree" ? -node.depth : node.depth}
          selected={selectedNodeId === node.id}
          recommended={Boolean(learningPath?.recommendedTitle === node.title)}
          delay={index * 70}
          onClick={() => onFocus(node.id)}
        />
      ))}
    </div>
  );

  if (mode === "brick" && !focusNode) {
    return (
      <section className={`${styles.hierarchyStage} ${styles.brickStage}`}>
        {destination ? <DestinationNode destination={destination} /> : null}
        {destination ? <div className={styles.destinationGap}><span />Estimated Height +{destination.height}</div> : null}
        {firstBrickLayer.length ? renderCompactRow(firstBrickLayer, "up") : null}
        {firstBrickLayer.length && foundations.length ? <ConnectorBand count={Math.max(firstBrickLayer.length, foundations.length)} direction="up" /> : null}
        {foundations.length ? (
          <div className={styles.foundationBlock}>
            <span className={styles.layerLabel}>Height 0 · Foundation</span>
            {renderCompactRow(foundations, "down")}
          </div>
        ) : null}
        {busyLabel ? <Buffer label={busyLabel} /> : null}
      </section>
    );
  }

  if (!focusNode) return null;

  const focusCard = (
    <KnowledgeNode
      node={focusNode}
      mode={mode}
      level={focusLevel}
      selected={selectedNodeId === focusNode.id}
      recommended={Boolean(learningPath?.recommendedTitle === focusNode.title)}
      recommendationReason={learningPath?.recommendedTitle === focusNode.title ? learningPath.recommendationReason : undefined}
      explanation={explanations[focusNode.id]}
      generated={generatedNodeIds.has(focusNode.id)}
      busy={loadingNodeId === focusNode.id}
      busyLabel={loadingNodeId === focusNode.id ? busyLabel : undefined}
      explanationLoading={explanationLoadingNodeId === focusNode.id}
      resourceLoading={resourceLoadingNodeId === focusNode.id}
      error={selectedNodeId === focusNode.id ? error : undefined}
      warnings={selectedNodeId === focusNode.id ? warnings : []}
      onExplain={() => onExplain(focusNode.id)}
      onContinue={() => onContinue(focusNode.id)}
      onFindResources={() => onFindResources(focusNode.id)}
      onMarkKnown={() => onMarkKnown(focusNode.id)}
      onTreeFromHere={() => onTreeFromHere(focusNode.id)}
      onBrickFromHere={() => onBrickFromHere(focusNode.id)}
      onDismissMessages={onDismissMessages}
    />
  );

  return (
    <section className={`${styles.hierarchyStage} ${mode === "tree" ? styles.treeStage : styles.brickStage}`}>
      <div className={styles.focusToolbar}>
        {focusParent ? <button type="button" onClick={onBack}>← {mode === "tree" ? "Previous branch" : "Previous layer"}</button> : <span />}
        <span>{levelLabel(mode, focusLevel)}</span>
      </div>

      {mode === "tree" ? (
        <>
          {focusCard}
          {children.length ? <ConnectorBand count={children.length} direction="down" /> : null}
          {children.length ? renderCompactRow(children, "down") : null}
        </>
      ) : (
        <>
          {destination ? <DestinationNode destination={destination} /> : null}
          {destination && children.length ? <div className={styles.destinationGap}><span />Destination remains above the generated layers</div> : null}
          {children.length ? renderCompactRow(children, "up") : null}
          {children.length ? <ConnectorBand count={children.length} direction="up" /> : null}
          {focusCard}
        </>
      )}
    </section>
  );
}

function DestinationNode({ destination }: { destination: { title: string; height: number; reason: string } }) {
  return (
    <article className={styles.destinationNode}>
      <span>Destination · Height +{destination.height}</span>
      <strong>{destination.title}</strong>
      <p>{destination.reason}</p>
    </article>
  );
}

function ConnectorBand({ count, direction }: { count: number; direction: "up" | "down" }) {
  return (
    <div className={`${styles.connectorBand} ${direction === "up" ? styles.connectorUp : styles.connectorDown}`} aria-hidden="true">
      <span className={styles.connectorStem} />
      <span className={styles.connectorBar} />
      <div className={styles.connectorDrops}>
        {Array.from({ length: Math.max(1, count) }, (_, index) => <i key={index} />)}
      </div>
    </div>
  );
}

function CompactNode({ node, mode, level, selected, recommended, delay, onClick }: {
  node: ConceptNode;
  mode: PrimaryMode;
  level: number;
  selected: boolean;
  recommended: boolean;
  delay: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.compactNode} ${selected ? styles.compactSelected : ""}`}
      style={{ animationDelay: `${delay}ms` }}
      onClick={onClick}
    >
      <span>{levelLabel(mode, level)}</span>
      <strong>{node.title}</strong>
      <p>{node.shortDescription}</p>
      <small>{statusText(node.knowledgeStatus)}{recommended ? " · Recommended" : ""}</small>
    </button>
  );
}


function SetupNode({
  mode,
  treeIntent,
  brickIntent,
  topic,
  knownInput,
  goal,
  profile,
  documents,
  busyLabel,
  error,
  warnings,
  onModeChange,
  onTreeIntentChange,
  onBrickIntentChange,
  onTopicChange,
  onKnownInputChange,
  onGoalChange,
  onProfileChange,
  onGenerate,
  onAddDocument,
  onRemoveDocument,
  onToggleDocument,
  onUseDocumentAsTopic,
  onDownload,
  onUpload,
  onDismissError,
  onDismissWarnings,
}: {
  mode: PrimaryMode;
  treeIntent: TreeIntent;
  brickIntent: BrickIntent;
  topic: string;
  knownInput: string;
  goal: string;
  profile: LearnerProfileType;
  documents: ExtractedDocument[];
  busyLabel?: string;
  error?: string;
  warnings: string[];
  onModeChange: (mode: PrimaryMode) => void;
  onTreeIntentChange: (intent: TreeIntent) => void;
  onBrickIntentChange: (intent: BrickIntent) => void;
  onTopicChange: (value: string) => void;
  onKnownInputChange: (value: string) => void;
  onGoalChange: (value: string) => void;
  onProfileChange: (profile: LearnerProfileType) => void;
  onGenerate: (event: FormEvent) => void;
  onAddDocument: (document: ExtractedDocument) => void;
  onRemoveDocument: (id: string) => void;
  onToggleDocument: (id: string) => void;
  onUseDocumentAsTopic: (document: ExtractedDocument) => void;
  onDownload: () => void;
  onUpload: (file: File) => Promise<void>;
  onDismissError: () => void;
  onDismissWarnings: () => void;
}) {
  const axis = modeAxis(mode);
  return (
    <article className={styles.setupNode}>
      <div className={styles.nodeMeta}><span>{axis} 0</span><b>Starting point</b></div>
      <header className={styles.setupHeader}>
        <div><p>Start here</p><h2>{mode === "tree" ? "What do you want to understand?" : "What do you already understand?"}</h2></div>
        <label className={styles.compactSelect}>Direction
          <select value={mode} onChange={(event) => onModeChange(event.target.value as PrimaryMode)}>
            <option value="tree">Tree</option>
            <option value="brick">Brick</option>
          </select>
        </label>
      </header>
      <form className={styles.setupForm} onSubmit={onGenerate}>
        {mode === "tree" ? (
          <>
            <label>Tree action
              <select value={treeIntent} onChange={(event) => onTreeIntentChange(event.target.value as TreeIntent)}>
                <option value="decompose">Cut down</option>
                <option value="trace-prerequisites">Trace roots</option>
                <option value="analyze-question">Analyze a question</option>
              </select>
            </label>
            <label className={styles.fullField}>{TREE_INTENT_COPY[treeIntent].prompt}
              <textarea rows={treeIntent === "analyze-question" ? 3 : 2} value={topic} onChange={(event) => onTopicChange(event.target.value)} placeholder={TREE_INTENT_COPY[treeIntent].placeholder} />
            </label>
            {treeIntent === "trace-prerequisites" ? (
              <label className={styles.fullField}>What can Tree stop at because you already know it?
                <input value={knownInput} onChange={(event) => onKnownInputChange(event.target.value)} placeholder="Algebra, derivatives…" />
              </label>
            ) : null}
          </>
        ) : (
          <>
            <label>Brick action
              <select value={brickIntent} onChange={(event) => onBrickIntentChange(event.target.value as BrickIntent)}>
                <option value="explore">Explore from here</option>
                <option value="destination">Build toward a destination</option>
              </select>
            </label>
            <label className={styles.fullField}>What do you already know?
              <textarea rows={3} value={knownInput} onChange={(event) => onKnownInputChange(event.target.value)} placeholder="Algebra, Python, basic statistics…" />
            </label>
            {brickIntent === "destination" ? (
              <label className={styles.fullField}>Where do you want to get?
                <input value={goal} onChange={(event) => onGoalChange(event.target.value)} placeholder="Understand machine learning" />
              </label>
            ) : null}
          </>
        )}

        <details className={`${styles.setupAdvanced} ${styles.fullField}`}>
          <summary>Optional context</summary>
          <div className={styles.advancedBody}>
            <LearnerProfile profile={profile} onChange={onProfileChange} />
            <DocumentSources
              documents={documents}
              activeDocumentIds={new Set(profile.sourceDocumentIds)}
              sourceMode={profile.sourceMode ?? "general"}
              onAdd={onAddDocument}
              onRemove={onRemoveDocument}
              onToggleActive={onToggleDocument}
              onUseAsTopic={onUseDocumentAsTopic}
            />
            <SessionTransfer hasSession={Boolean(documents.length)} onDownload={onDownload} onUpload={onUpload} />
          </div>
        </details>

        {error ? <div className={styles.nodeNotice}><span>{error}</span><button type="button" onClick={onDismissError}>×</button></div> : null}
        {warnings.length ? <div className={styles.nodeNotice}><span>{warnings.join(" ")}</span><button type="button" onClick={onDismissWarnings}>×</button></div> : null}
        {busyLabel ? <Buffer label={busyLabel} /> : null}
        <button type="submit" className={styles.primaryAction} disabled={Boolean(busyLabel)}>{busyLabel ? (mode === "tree" ? "Branching…" : "Constructing…") : mode === "tree" ? TREE_INTENT_COPY[treeIntent].action : "Construct Brick"}</button>
      </form>
    </article>
  );
}

function KnowledgeNode({
  node,
  mode,
  level,
  selected,
  recommended,
  recommendationReason,
  explanation,
  generated,
  busy,
  busyLabel,
  explanationLoading,
  resourceLoading,
  error,
  warnings,
  onExplain,
  onContinue,
  onFindResources,
  onMarkKnown,
  onTreeFromHere,
  onBrickFromHere,
  onDismissMessages,
}: {
  node: ConceptNode;
  mode: PrimaryMode;
  level: number;
  selected: boolean;
  recommended: boolean;
  recommendationReason?: string;
  explanation?: AdaptiveExplanation;
  generated: boolean;
  busy: boolean;
  busyLabel?: string;
  explanationLoading: boolean;
  resourceLoading: boolean;
  error?: string;
  warnings: string[];
  onExplain: () => void;
  onContinue: () => void;
  onFindResources: () => void;
  onMarkKnown: () => void;
  onTreeFromHere: () => void;
  onBrickFromHere: () => void;
  onDismissMessages: () => void;
}) {
  return (
    <article className={`${styles.knowledgeNode} ${selected ? styles.nodeSelected : ""}`}>
      <div className={styles.nodeMeta}>
        <span>{levelLabel(mode, level)}</span>
        <b>{mode === "tree" ? "Focused branch" : "Focused brick"}</b>
      </div>

      <div className={styles.nodeHeading}>
        <div>
          <div className={styles.nodeFlags}>
            <span>{statusText(node.knowledgeStatus)}</span>
            {recommended ? <strong>Recommended</strong> : null}
          </div>
          <h2>{node.title}</h2>
        </div>
      </div>

      <p className={styles.nodeBrief}>{node.shortDescription}</p>
      {recommendationReason ? <p className={styles.recommendation}>{recommendationReason}</p> : null}

      {busy ? <Buffer label={busyLabel} /> : null}
      {error || warnings.length ? (
        <div className={styles.nodeNotice}>
          <span>{[error, ...warnings].filter(Boolean).join(" ")}</span>
          <button type="button" onClick={onDismissMessages}>×</button>
        </div>
      ) : null}

      <details
        className={styles.nodeDetails}
        onToggle={(event) => {
          if (event.currentTarget.open && !explanation) onExplain();
        }}
      >
        <summary>{explanationLoading ? "Loading detail…" : "Open detail + resources"}</summary>
        <div className={styles.detailBody}>
          <section>
            <h3>Explanation</h3>
            <p>{explanation?.explanation || node.detailedExplanation || node.difficultyExplanation}</p>
            {explanation?.example ? <div className={styles.example}><strong>Example</strong><p>{explanation.example}</p></div> : null}
            {explanation?.keyTakeaway ? <div className={styles.takeaway}>{explanation.keyTakeaway}</div> : null}
          </section>

          {node.whyItMatters ? <section><h3>Why this node matters</h3><p>{node.whyItMatters}</p></section> : null}

          <div className={styles.detailGrid}>
            <section>
              <h3>Prerequisites</h3>
              {node.prerequisites.length ? <ul>{node.prerequisites.slice(0, 6).map((item) => <li key={item}>{item}</li>)}</ul> : <p>None listed yet.</p>}
            </section>
            <section>
              <h3>{mode === "tree" ? "What this branch reveals" : "What this brick unlocks"}</h3>
              {node.whatItUnlocks?.length ? <ul>{node.whatItUnlocks.slice(0, 6).map((item) => <li key={item}>{item}</li>)}</ul> : <p>{mode === "tree" ? "Branch this node to cut it one level deeper." : "Construct the next layer to see what becomes reachable."}</p>}
            </section>
          </div>

          <section>
            <div className={styles.resourceHeader}>
              <h3>Resources</h3>
              <button type="button" onClick={onFindResources} disabled={resourceLoading}>
                {resourceLoading ? "Finding…" : node.resources.length ? "Refresh" : "Find resources"}
              </button>
            </div>
            {node.resources.length ? (
              <div className={styles.resources}>
                {node.resources.map((resource) => (
                  <a key={resource.url} href={resource.url} target="_blank" rel="noreferrer">
                    <strong>{resource.title}</strong>
                    <span>{resource.source} · {resource.type}</span>
                  </a>
                ))}
              </div>
            ) : <p>Resources are loaded only when you ask for them.</p>}
          </section>

          <div className={styles.secondaryActions}>
            {node.knowledgeStatus !== "known" ? <button type="button" onClick={onMarkKnown}>Mark known</button> : null}
            {mode !== "tree" ? <button type="button" onClick={onTreeFromHere}>Open as new Tree</button> : null}
            {mode !== "brick" ? <button type="button" onClick={onBrickFromHere}>Open as new Brick</button> : null}
          </div>
        </div>
      </details>

      <button type="button" className={styles.continueButton} onClick={onContinue} disabled={busy}>
        {busy
          ? mode === "tree" ? "Branching…" : "Constructing…"
          : generated
            ? mode === "tree" ? "Show branch children" : "Show next layer"
            : mode === "tree" ? "Branch this node" : "Construct next layer"}
        <span aria-hidden="true">{mode === "tree" ? "↓" : "↑"}</span>
      </button>
    </article>
  );
}

function NavigatorDrawer({
  open,
  mode,
  workspaces,
  activeWorkspaceId,
  nodes,
  edges,
  activeNodeId,
  learningPath,
  goal,
  hasSession,
  onClose,
  onSwitchWorkspace,
  onTeleport,
  onDownload,
  onNew,
}: {
  open: boolean;
  mode: PrimaryMode;
  workspaces: WorkspaceSnapshot[];
  activeWorkspaceId?: string;
  nodes: ConceptNode[];
  edges: ConceptEdge[];
  activeNodeId?: string;
  learningPath?: LearningPathProposal;
  goal: string;
  hasSession: boolean;
  onClose: () => void;
  onSwitchWorkspace: (id: string) => void;
  onTeleport: (id: string) => void;
  onDownload: () => void;
  onNew: () => void;
}) {
  const treeWorkspaces = workspaces.filter((workspace) => workspace.mode === "tree");
  const brickWorkspaces = workspaces.filter((workspace) => workspace.mode === "brick");

  return (
    <aside className={`${styles.navigator} ${open ? styles.navigatorOpen : ""}`} aria-hidden={!open}>
      <header>
        <div>
          <small>Workspace map</small>
          <strong>{mode === "tree" ? "Tree" : "Brick"}</strong>
        </div>
        <button type="button" onClick={onClose}>×</button>
      </header>

      <section className={styles.workspaceSwitcher}>
        <div>
          <span>Tree maps</span>
          {treeWorkspaces.length ? treeWorkspaces.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              className={workspace.id === activeWorkspaceId ? styles.workspaceActive : ""}
              onClick={() => onSwitchWorkspace(workspace.id)}
            >
              {workspace.name}
            </button>
          )) : <small>No Trees yet.</small>}
        </div>
        <div>
          <span>Brick maps</span>
          {brickWorkspaces.length ? brickWorkspaces.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              className={workspace.id === activeWorkspaceId ? styles.workspaceActive : ""}
              onClick={() => onSwitchWorkspace(workspace.id)}
            >
              {workspace.name}
            </button>
          )) : <small>No Bricks yet.</small>}
        </div>
      </section>

      <MiniGraphMap
        mode={mode}
        nodes={nodes}
        edges={edges}
        activeNodeId={activeNodeId}
        destination={mode === "brick" && learningPath?.estimatedDestinationHeight && goal.trim()
          ? { title: goal.trim(), height: learningPath.estimatedDestinationHeight }
          : undefined}
        onTeleport={onTeleport}
      />

      <footer>
        <button type="button" onClick={onNew}>New {mode === "tree" ? "Tree" : "Brick"}</button>
        <button type="button" disabled={!hasSession} onClick={onDownload}>Download session</button>
      </footer>
    </aside>
  );
}

function MiniGraphMap({ mode, nodes, edges, activeNodeId, destination, onTeleport }: {
  mode: PrimaryMode;
  nodes: ConceptNode[];
  edges: ConceptEdge[];
  activeNodeId?: string;
  destination?: { title: string; height: number };
  onTeleport: (id: string) => void;
}) {
  if (!nodes.length) return <p className={styles.emptyMap}>Your map will appear here.</p>;

  const grouped = new Map<number, ConceptNode[]>();
  for (const node of nodes) {
    const items = grouped.get(node.depth) ?? [];
    items.push(node);
    grouped.set(node.depth, items);
  }
  for (const items of grouped.values()) items.sort((a, b) => a.title.localeCompare(b.title));

  const depths = [...grouped.keys()].sort((a, b) => mode === "tree" ? a - b : b - a);
  const destinationOffset = destination ? 74 : 0;
  const rowGap = 92;
  const width = 1000;
  const positions = new Map<string, { x: number; y: number }>();

  depths.forEach((depth, rowIndex) => {
    const row = grouped.get(depth) ?? [];
    row.forEach((node, index) => {
      positions.set(node.id, {
        x: ((index + 1) / (row.length + 1)) * width,
        y: destinationOffset + 42 + rowIndex * rowGap,
      });
    });
  });

  const height = Math.max(170, destinationOffset + depths.length * rowGap + 54);

  return (
    <div className={styles.miniGraph} style={{ height }}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        {edges.map((edge) => {
          const source = positions.get(edge.source);
          const target = positions.get(edge.target);
          if (!source || !target) return null;
          const midY = (source.y + target.y) / 2;
          return (
            <path
              key={edge.id}
              d={`M ${source.x} ${source.y} C ${source.x} ${midY}, ${target.x} ${midY}, ${target.x} ${target.y}`}
              className={styles.miniEdge}
            />
          );
        })}
        {destination && depths.length ? (
          <path
            d={`M 500 42 L 500 ${destinationOffset + 18}`}
            className={`${styles.miniEdge} ${styles.miniEdgeDashed}`}
          />
        ) : null}
      </svg>

      {destination ? (
        <div className={styles.miniDestination}>
          <small>+{destination.height}</small>
          <strong>{destination.title}</strong>
        </div>
      ) : null}

      {nodes.map((node) => {
        const position = positions.get(node.id);
        if (!position) return null;
        return (
          <button
            key={node.id}
            type="button"
            className={`${styles.miniNode} ${node.id === activeNodeId ? styles.miniNodeActive : ""}`}
            style={{ left: `${position.x / 10}%`, top: position.y }}
            onClick={() => onTeleport(node.id)}
            title={node.shortDescription}
          >
            <small>{mode === "tree" ? -node.depth : node.depth > 0 ? `+${node.depth}` : "0"}</small>
            <span>{node.title}</span>
          </button>
        );
      })}
    </div>
  );
}

