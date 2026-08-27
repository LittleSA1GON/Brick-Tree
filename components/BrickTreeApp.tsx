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
import { buildHierarchyLayout } from "@/lib/graph/hierarchy-layout";
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
  createPortableWorkspaceFile,
  parsePortableSessionFile,
  parsePortableWorkspaceFile,
  safeSessionFileName,
  safeWorkspaceFileName,
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
  educationLevel: "high-school",
  exploreBias: "balanced",
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
  const [graphZoom, setGraphZoom] = useState(1);
  const requestRef = useRef<AbortController | null>(null);
  const resourceAttemptedRef = useRef<Set<string>>(new Set());

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
    .filter((node) => !(mode === "brick" && node.id === rootNode?.id && node.title === "Your Foundations")), [nodes, mode, rootNode?.id]);

  const focusNode = useMemo(() => {
    if (!focusedNodeId) return undefined;
    const requestedNode = nodes.find((node) => node.id === focusedNodeId);
    if (mode === "brick" && requestedNode && requestedNode.id === rootNode?.id && requestedNode.title === "Your Foundations") return undefined;
    return requestedNode;
  }, [focusedNodeId, nodes, mode, rootNode]);

  const nodeLevel = useCallback((node: ConceptNode) => {
    const offset = Math.max(0, node.depth - baseDepth);
    return mode === "tree" ? -offset : offset;
  }, [baseDepth, mode]);

  const availableLevels = useMemo(() => [...new Set(mapNodes.map((node) => nodeLevel(node)))].sort((a, b) => b - a), [mapNodes, nodeLevel]);

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
        setFocusedNodeId(undefined);
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
        // Brick starts from the foundation row at the bottom in its compact state.
        // Nothing is auto-focused here, otherwise scrollIntoView would pull the
        // initial construction away from its bottom-origin starting position.
        setFocusedNodeId(undefined);
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
        : `Constructing the next Brick row above the current top layer, with ${node.title} as the emphasis…`,
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

  useEffect(() => {
    if (!focusNode || focusNode.resources.length || resourceLoadingNodeId === focusNode.id) return;
    const key = `${activeWorkspaceId ?? "workspace"}:${focusNode.id}`;
    if (resourceAttemptedRef.current.has(key)) return;
    resourceAttemptedRef.current.add(key);
    void findResources(focusNode.id);
    // Resource discovery is intentionally attempted once per focused node/workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, focusNode?.id, focusNode?.resources.length]);

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

  function activeWorkspaceSnapshot(): WorkspaceSnapshot | undefined {
    if (!activeWorkspaceId) return undefined;
    const stored = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
    return {
      id: activeWorkspaceId,
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
      createdAt: stored?.createdAt ?? Date.now(),
    };
  }

  function downloadWorkspace() {
    const workspace = activeWorkspaceSnapshot();
    if (!workspace) return;
    const portable = createPortableWorkspaceFile(workspace);
    const blob = new Blob([JSON.stringify(portable, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = safeWorkspaceFileName(workspace.name, workspace.mode);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function uploadWorkspace(file: File) {
    if (file.size > 8 * 1024 * 1024) throw new Error("Brick Tree workspace files are limited to 8 MB.");
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(await file.text());
    } catch {
      throw new Error("That file is not valid JSON.");
    }
    const saved = parsePortableWorkspaceFile(parsedJson).workspace;
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const imported: WorkspaceSnapshot = {
      ...saved,
      id,
      name: saved.name || (saved.mode === "tree" ? "Imported Tree" : "Imported Brick"),
      nodes: saved.nodes.map(migrateNode),
      explanations: saved.explanations as Record<string, AdaptiveExplanation>,
      createdAt: Date.now(),
    };
    setWorkspaces((current) => [...current, imported].slice(-40));
    applyWorkspace(imported);
    setPhase("workspace");
    setDrawerOpen(false);
    setWarnings([`Imported ${imported.mode === "tree" ? "Tree" : "Brick"}: ${imported.name}.`]);
  }

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
      {mapNodes.length > 0 ? (
        <ZoomControls
          value={graphZoom}
          onDecrease={() => setGraphZoom((value) => Math.max(0.65, Math.round((value - 0.1) * 100) / 100))}
          onIncrease={() => setGraphZoom((value) => Math.min(1.45, Math.round((value + 0.1) * 100) / 100))}
          onReset={() => setGraphZoom(1)}
        />
      ) : null}

      <AxisRail
        key={`${activeWorkspaceId ?? mode}:${mode}`}
        axis={modeAxis(mode)}
        levels={availableLevels}
        activeLevel={focusNode ? nodeLevel(focusNode) : 0}
        descriptors={levels}
        dismissKey={focusNode?.id ?? selectedNodeId ?? "none"}
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
              onDownloadWorkspace={downloadWorkspace}
              onUpload={uploadSession}
              onUploadWorkspace={uploadWorkspace}
              onDismissError={() => setError(undefined)}
              onDismissWarnings={() => setWarnings([])}
            />
          </section>
        ) : (
          <HierarchyStage
            key={`${activeWorkspaceId ?? "workspace"}`}
            mode={mode}
            zoom={graphZoom}
            nodes={mapNodes}
            edges={edges}
            focusNode={focusNode}
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
            onClearFocus={() => {
              setFocusedNodeId(undefined);
              setSelectedNodeId(undefined);
              setError(undefined);
              setWarnings([]);
            }}
            onContinue={(id) => { selectNode(id, false); void expandNode(id); }}
            onExplain={(id) => void explainNode(id, explanationLevel(profile))}
            onMarkKnown={markKnown}
            onTreeFromHere={(id) => branchFromNode(id, "tree")}
            onBrickFromHere={(id) => branchFromNode(id, "brick")}
            onDismissMessages={() => { setError(undefined); setWarnings([]); }}
          />
        )}
      </div>

      <PersistentMiniMap
        mode={mode}
        nodes={mapNodes}
        edges={edges}
        activeNodeId={focusNode?.id ?? selectedNodeId}
        learningPath={learningPath}
        goal={goal}
        onOpen={() => setDrawerOpen(true)}
      />

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
        hasWorkspace={Boolean(activeWorkspaceId)}
        onClose={() => setDrawerOpen(false)}
        onSwitchWorkspace={switchWorkspace}
        onTeleport={teleportNode}
        onDownload={downloadSession}
        onDownloadWorkspace={downloadWorkspace}
        onUploadWorkspace={uploadWorkspace}
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


function ZoomControls({ value, onDecrease, onIncrease, onReset }: {
  value: number;
  onDecrease: () => void;
  onIncrease: () => void;
  onReset: () => void;
}) {
  return (
    <div className={styles.zoomControls} aria-label="Graph zoom controls">
      <button type="button" onClick={onDecrease} disabled={value <= 0.65} aria-label="Zoom out">−</button>
      <button type="button" className={styles.zoomValue} onClick={onReset} aria-label="Reset graph zoom">{Math.round(value * 100)}%</button>
      <button type="button" onClick={onIncrease} disabled={value >= 1.45} aria-label="Zoom in">+</button>
    </div>
  );
}

function AxisRail({ axis, levels, activeLevel, descriptors, dismissKey, onSelect }: {
  axis: "Depth" | "Height";
  levels: number[];
  activeLevel: number;
  descriptors: GraphLevelDescriptor[];
  dismissKey: string;
  onSelect: (level: number) => void;
}) {
  const [openLevel, setOpenLevel] = useState<number>();
  const railRef = useRef<HTMLElement | null>(null);
  const axisKey = axis === "Depth" ? "depth" : "height";
  const available = levels.length ? levels : [0];
  const descriptor = openLevel === undefined
    ? undefined
    : descriptors.find((item) => item.axis === axisKey && item.index === Math.abs(openLevel));

  useEffect(() => {
    setOpenLevel(undefined);
  }, [dismissKey]);

  useEffect(() => {
    if (openLevel === undefined) return;

    const closeWhenOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!railRef.current?.contains(target)) setOpenLevel(undefined);
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenLevel(undefined);
    };

    document.addEventListener("pointerdown", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openLevel]);

  return (
    <aside ref={railRef} className={styles.axisRail} aria-label={`${axis} levels`}>
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
      <span>{axis}</span>
      {openLevel !== undefined ? (
        <div className={styles.axisPopover}>
          <strong>{axis} {openLevel > 0 ? `+${openLevel}` : openLevel}</strong>
          <small>Why these nodes share this level</small>
          <p>{descriptor?.peerRule || (openLevel === 0
            ? axis === "Depth"
              ? "Depth 0 contains the single root concept that defines this Tree's starting reference."
              : "Height 0 contains the learner's stated foundation bricks, which define this Brick workspace's starting reference."
            : "The nodes on this layer are intended to require comparable prerequisite knowledge and reasoning effort.")}</p>
          <small>{openLevel === 0 ? "Why this is the baseline" : "Compared with the previous layer"}</small>
          <p>{descriptor?.description || (openLevel === 0
            ? axis === "Depth"
              ? "This root is the concept or question the learner chose before any cuts are made."
              : "This foundation is the knowledge the learner supplied before any higher Brick layers are constructed."
            : axis === "Depth"
              ? "This cut should be one directly understandable step simpler, more foundational, or more specific than its parent layer."
              : "This row should be one directly reachable learning step more complex than the Brick row below it.")}</p>
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
  zoom,
  nodes,
  edges,
  focusNode,
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
  onClearFocus,
  onContinue,
  onExplain,
  onMarkKnown,
  onTreeFromHere,
  onBrickFromHere,
  onDismissMessages,
}: {
  mode: PrimaryMode;
  zoom: number;
  nodes: ConceptNode[];
  edges: ConceptEdge[];
  focusNode?: ConceptNode;
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
  onClearFocus: () => void;
  onContinue: (id: string) => void;
  onExplain: (id: string) => void;
  onMarkKnown: (id: string) => void;
  onTreeFromHere: (id: string) => void;
  onBrickFromHere: (id: string) => void;
  onDismissMessages: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 1200, height: 760 });
  const destination = mode === "brick" && learningPath?.estimatedDestinationHeight && goal.trim()
    ? {
        title: goal.trim(),
        height: learningPath.estimatedDestinationHeight,
        reason: learningPath.destinationHeightReason || "Estimated from the gap between your current foundation and the destination.",
      }
    : undefined;

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const update = () => setViewportSize({ width: scroller.clientWidth || 1200, height: scroller.clientHeight || 760 });
    update();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : undefined;
    observer?.observe(scroller);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const layout = useMemo(() => {
    const aspect = viewportSize.width / Math.max(1, viewportSize.height);
    const nodeGap = Math.round(Math.max(250, Math.min(aspect > 1.8 ? 380 : 340, viewportSize.width * (aspect > 1.8 ? 0.2 : 0.28))));
    const rowGap = Math.round(Math.max(158, Math.min(220, viewportSize.height * 0.24)));
    const paddingX = Math.round(Math.max(220, Math.min(420, viewportSize.width * 0.3)));
    const paddingY = Math.round(Math.max(240, Math.min(420, viewportSize.height * 0.42)));
    return buildHierarchyLayout(mode, nodes, edges, {
      nodeGap: mode === "tree" ? nodeGap : Math.max(nodeGap, 280),
      rowGap,
      paddingX,
      paddingY: mode === "tree" ? paddingY : Math.max(paddingY, 300),
      destinationOffset: destination ? 126 : 0,
    });
  }, [mode, nodes, edges, destination, viewportSize]);

  const scaledWidth = Math.max(viewportSize.width, Math.ceil(layout.width * zoom));
  const scaledHeight = Math.max(viewportSize.height, Math.ceil(layout.height * zoom));

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const timer = window.setTimeout(() => {
      const target = scroller.querySelector<HTMLElement>('[data-focus-target="true"]');
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        return;
      }
      const left = Math.max(0, (scroller.scrollWidth - scroller.clientWidth) / 2);
      const top = mode === "brick"
        ? Math.max(0, scroller.scrollHeight - scroller.clientHeight)
        : 0;
      scroller.scrollTo({ left, top, behavior: "smooth" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [focusNode?.id, mode, scaledHeight, scaledWidth, nodes.length, edges.length, zoom]);

  const topBrickDepth = nodes.reduce((value, node) => Math.max(value, node.depth), 0);

  return (
    <section className={`${styles.hierarchyStage} ${mode === "tree" ? styles.treeStage : styles.brickStage}`}>
      <div ref={scrollerRef} className={styles.graphScroller} aria-label={`${mode === "tree" ? "Tree" : "Brick"} graph. Scroll vertically and horizontally; swipe on touch devices.`}>
        <div
          className={styles.graphCanvas}
          style={{ width: scaledWidth, height: scaledHeight }}
          onClick={(event) => {
            if (event.target === event.currentTarget) onClearFocus();
          }}
        >
          <div
            className={`${styles.graphPlane} ${mode === "brick" ? styles.graphPlaneBrick : styles.graphPlaneTree}`}
            style={{
              width: layout.width,
              height: layout.height,
              left: scaledWidth / 2,
              transform: `translateX(-50%) scale(${zoom})`,
              transformOrigin: mode === "brick" ? "center bottom" : "center top",
            }}
            onClick={(event) => {
              if (event.target === event.currentTarget) onClearFocus();
            }}
          >
          <svg className={styles.graphEdges} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
            {edges.map((edge) => {
              const source = layout.positions.get(edge.source);
              const target = layout.positions.get(edge.target);
              if (!source || !target) return null;
              const middleY = (source.y + target.y) / 2;
              return (
                <path
                  key={edge.id}
                  d={`M ${source.x} ${source.y} C ${source.x} ${middleY}, ${target.x} ${middleY}, ${target.x} ${target.y}`}
                  className={styles.graphEdge}
                />
              );
            })}
            {destination ? (
              <path
                d={`M ${layout.width / 2} 54 L ${layout.width / 2} ${126 + 56}`}
                className={`${styles.graphEdge} ${styles.graphEdgeDashed}`}
              />
            ) : null}
          </svg>

          {destination ? (
            <div className={styles.graphDestination} style={{ left: layout.width / 2, top: 48 }}>
              <DestinationNode destination={destination} />
            </div>
          ) : null}

          {nodes.map((node, index) => {
            const point = layout.positions.get(node.id);
            if (!point) return null;
            const focused = focusNode?.id === node.id;
            const level = mode === "tree" ? -node.depth : node.depth;
            const treeScale = Math.max(0.58, 1 - node.depth * 0.065);
            const brickDistance = Math.abs(topBrickDepth - node.depth);
            const compactScale = mode === "tree" ? treeScale : Math.max(0.72, 0.94 - brickDistance * 0.025);

            return (
              <div
                key={node.id}
                className={`${styles.graphNodeWrapper} ${focused ? styles.graphNodeFocused : ""}`}
                style={{
                  left: point.x,
                  top: point.y,
                  transform: `translate(-50%, -50%) scale(${focused ? 1 : compactScale})`,
                }}
                data-focus-target={focused ? "true" : undefined}
              >
                {focused ? (
                  <KnowledgeNode
                    node={node}
                    mode={mode}
                    level={level}
                    selected={selectedNodeId === node.id}
                    recommended={Boolean(learningPath?.recommendedTitle === node.title)}
                    recommendationReason={learningPath?.recommendedTitle === node.title ? learningPath.recommendationReason : undefined}
                    explanation={explanations[node.id]}
                    generated={generatedNodeIds.has(node.id)}
                    busy={loadingNodeId === node.id}
                    busyLabel={loadingNodeId === node.id ? busyLabel : undefined}
                    explanationLoading={explanationLoadingNodeId === node.id}
                    resourceLoading={resourceLoadingNodeId === node.id}
                    error={selectedNodeId === node.id ? error : undefined}
                    warnings={selectedNodeId === node.id ? warnings : []}
                    onExplain={() => onExplain(node.id)}
                    onContinue={() => onContinue(node.id)}
                    onMarkKnown={() => onMarkKnown(node.id)}
                    onTreeFromHere={() => onTreeFromHere(node.id)}
                    onBrickFromHere={() => onBrickFromHere(node.id)}
                    onDismissMessages={onDismissMessages}
                  />
                ) : (
                  <CompactNode
                    node={node}
                    mode={mode}
                    level={level}
                    selected={selectedNodeId === node.id}
                    recommended={Boolean(learningPath?.recommendedTitle === node.title)}
                    delay={Math.min(index * 45, 360)}
                    onClick={() => onFocus(node.id)}
                  />
                )}
              </div>
            );
          })}
          </div>
        </div>
      </div>
      <div className={styles.navigationHint}>
        <span>↕ Scroll levels</span>
        <span>↔ Scroll or swipe siblings</span>
      </div>
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
  onDownloadWorkspace,
  onUpload,
  onUploadWorkspace,
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
  onDownloadWorkspace: () => void;
  onUpload: (file: File) => Promise<void>;
  onUploadWorkspace: (file: File) => Promise<void>;
  onDismissError: () => void;
  onDismissWarnings: () => void;
}) {
  const axis = modeAxis(mode);
  return (
    <article className={styles.setupNode}>
      <div className={styles.nodeMeta}><span>{axis} 0</span><b>Starting point</b></div>
      <header className={styles.setupHeader}>
        <div><p>Start here</p><h2>{mode === "tree" ? "What do you want to understand?" : "What do you already understand?"}</h2></div>
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
            <label>Learner / difficulty level
              <select
                value={profile.educationLevel ?? "high-school"}
                onChange={(event) => onProfileChange({ ...profile, educationLevel: event.target.value })}
              >
                <option value="elementary">Elementary school</option>
                <option value="middle-school">Middle school</option>
                <option value="high-school">High school</option>
                <option value="college">College / university</option>
                <option value="graduate">Graduate study</option>
                <option value="professional">Professional / specialist</option>
                <option value="self-directed">Self-directed</option>
              </select>
            </label>
            {brickIntent === "explore" ? (
              <label>Explore bias
                <select
                  value={profile.exploreBias ?? "balanced"}
                  onChange={(event) => onProfileChange({ ...profile, exploreBias: event.target.value as LearnerProfileType["exploreBias"] })}
                >
                  <option value="balanced">Balanced breadth</option>
                  <option value="practical">Practical skills</option>
                  <option value="academic">Academic foundations</option>
                  <option value="creative">Creative applications</option>
                  <option value="career">Career usefulness</option>
                  <option value="technical">Technical depth</option>
                </select>
              </label>
            ) : null}
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
            <SessionTransfer
              hasSession={Boolean(documents.length)}
              hasWorkspace={false}
              mode={mode}
              onDownload={onDownload}
              onDownloadWorkspace={onDownloadWorkspace}
              onUpload={onUpload}
              onUploadWorkspace={onUploadWorkspace}
            />
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
              <span>{resourceLoading ? "Loading…" : node.resources.length ? "Ready" : "Unavailable"}</span>
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
            ) : <p>{resourceLoading ? "Loading resources for this node…" : "No resource links are available for this node yet."}</p>}
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
  hasWorkspace,
  onClose,
  onSwitchWorkspace,
  onTeleport,
  onDownload,
  onDownloadWorkspace,
  onUploadWorkspace,
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
  hasWorkspace: boolean;
  onClose: () => void;
  onSwitchWorkspace: (id: string) => void;
  onTeleport: (id: string) => void;
  onDownload: () => void;
  onDownloadWorkspace: () => void;
  onUploadWorkspace: (file: File) => Promise<void>;
  onNew: () => void;
}) {
  const workspaceInputRef = useRef<HTMLInputElement | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const treeWorkspaces = workspaces.filter((workspace) => workspace.mode === "tree");
  const brickWorkspaces = workspaces.filter((workspace) => workspace.mode === "brick");

  async function importWorkspace(file: File) {
    setWorkspaceLoading(true);
    try {
      await onUploadWorkspace(file);
    } finally {
      setWorkspaceLoading(false);
      if (workspaceInputRef.current) workspaceInputRef.current.value = "";
    }
  }

  return (
    <aside className={`${styles.navigator} ${open ? styles.navigatorOpen : ""}`} aria-hidden={!open}>
      <header>
        <div>
          <strong>{mode === "tree" ? "Tree - Workspace map" : "Brick - Workspace map"}</strong>
          <small>Click any node to jump there.</small>
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
        <button type="button" disabled={!hasWorkspace} onClick={onDownloadWorkspace}>Download {mode}</button>
        <button type="button" disabled={workspaceLoading} onClick={() => workspaceInputRef.current?.click()}>
          {workspaceLoading ? "Loading…" : "Upload Tree / Brick"}
        </button>
        <input
          ref={workspaceInputRef}
          hidden
          type="file"
          accept=".json,.bricktree.json,application/json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importWorkspace(file);
          }}
        />
        <button type="button" disabled={!hasSession} onClick={onDownload}>Download session</button>
      </footer>
    </aside>
  );
}

function PersistentMiniMap({
  mode,
  nodes,
  edges,
  activeNodeId,
  learningPath,
  goal,
  onOpen,
}: {
  mode: PrimaryMode;
  nodes: ConceptNode[];
  edges: ConceptEdge[];
  activeNodeId?: string;
  learningPath?: LearningPathProposal;
  goal: string;
  onOpen: () => void;
}) {
  return (
    <aside className={styles.persistentMap} aria-label={`${mode === "tree" ? "Tree" : "Brick"} mini map`}>
      <span className={styles.persistentMapTitle}>{mode === "tree" ? "Tree" : "Brick"} map</span>
      <MiniGraphMap
        mode={mode}
        nodes={nodes}
        edges={edges}
        activeNodeId={activeNodeId}
        destination={mode === "brick" && learningPath?.estimatedDestinationHeight && goal.trim()
          ? { title: goal.trim(), height: learningPath.estimatedDestinationHeight }
          : undefined}
        onTeleport={() => onOpen()}
        compact
      />
      <button type="button" className={styles.persistentMapLaunch} onClick={onOpen}>Open map</button>
    </aside>
  );
}

function MiniGraphMap({ mode, nodes, edges, activeNodeId, destination, onTeleport, compact = false }: {
  mode: PrimaryMode;
  nodes: ConceptNode[];
  edges: ConceptEdge[];
  activeNodeId?: string;
  destination?: { title: string; height: number };
  onTeleport: (id: string) => void;
  compact?: boolean;
}) {
  if (!nodes.length) return <div className={`${styles.miniGraph} ${compact ? styles.miniGraphCompact : ""}`}><p className={styles.emptyMap}>Map starts here.</p></div>;

  const layout = buildHierarchyLayout(mode, nodes, edges, {
    nodeGap: compact ? 118 : 150,
    rowGap: compact ? 74 : 98,
    paddingX: compact ? 58 : 88,
    paddingY: compact ? 36 : 54,
    destinationOffset: destination ? (compact ? 56 : 82) : 0,
  });
  const scale = compact ? Math.min(1, 218 / layout.width) : 1;
  const renderWidth = Math.max(compact ? 210 : 640, layout.width * scale);
  const renderHeight = Math.max(compact ? 118 : 190, layout.height * scale);

  return (
    <div className={`${styles.miniGraph} ${compact ? styles.miniGraphCompact : ""}`}>
      <div className={styles.miniGraphCanvas} style={{ width: renderWidth, height: renderHeight }}>
        <svg viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="none" aria-hidden="true">
          {edges.map((edge) => {
            const source = layout.positions.get(edge.source);
            const target = layout.positions.get(edge.target);
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
          {destination ? (
            <path
              d={`M ${layout.width / 2} 28 L ${layout.width / 2} ${compact ? 78 : 116}`}
              className={`${styles.miniEdge} ${styles.miniEdgeDashed}`}
            />
          ) : null}
        </svg>

        {destination ? (
          <div
            className={styles.miniDestination}
            style={{ left: "50%", top: compact ? 10 : 16, transform: `translateX(-50%) scale(${compact ? 0.72 : 1})` }}
          >
            <small>+{destination.height}</small>
            <strong>{destination.title}</strong>
          </div>
        ) : null}

        {nodes.map((node) => {
          const position = layout.positions.get(node.id);
          if (!position) return null;
          return (
            <button
              key={node.id}
              type="button"
              className={`${styles.miniNode} ${compact ? styles.miniNodeCompact : ""} ${node.id === activeNodeId ? styles.miniNodeActive : ""}`}
              style={{ left: position.x * scale, top: position.y * scale }}
              onClick={(event) => {
                event.stopPropagation();
                onTeleport(node.id);
              }}
              title={node.shortDescription}
            >
              <small>{mode === "tree" ? -node.depth : node.depth > 0 ? `+${node.depth}` : "0"}</small>
              {!compact ? <span>{node.title}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
