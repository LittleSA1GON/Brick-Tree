"use client";

import {
  type CSSProperties,
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
  visibleGraph,
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

const TREE_INTENT_COPY: Record<
  TreeIntent,
  { title: string; prompt: string; placeholder: string; action: string; busy: string }
> = {
  decompose: {
    title: "Break down",
    prompt: "What do you want to cut down?",
    placeholder: "Machine learning",
    action: "Build Tree",
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

function connectionLabel(type: ConceptEdge["relationshipType"]): string {
  switch (type) {
    case "contains": return "contains";
    case "prerequisite": return "needs first";
    case "builds-on": return "builds on";
    case "leads-to": return "leads to";
    case "examines": return "examines";
    default: return "related to";
  }
}

function nodeLevelReason(
  mode: PrimaryMode,
  level: number,
  node: ConceptNode,
  startingDifficulty: number,
): string {
  if (level === 0) {
    return `0 is the starting point you supplied. ${mode === "tree" ? "Depth" : "Height"} counts steps away from this node, so the map does not pretend your starting knowledge begins at 1.`;
  }

  const direction = mode === "tree"
    ? `Depth ${level} is ${level} step${level === 1 ? "" : "s"} deeper into the idea or its foundations.`
    : `Height ${level} is ${level} step${level === 1 ? "" : "s"} beyond the starting knowledge.`;
  const comparison = node.difficulty > startingDifficulty
    ? "This node is more complex than level 0"
    : node.difficulty < startingDifficulty
      ? "This node is less complex than level 0"
      : "This node is about as complex as level 0";
  return `${direction} ${comparison} because ${node.difficultyExplanation.charAt(0).toLowerCase()}${node.difficultyExplanation.slice(1)}`;
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
  const [activeNodeId, setActiveNodeId] = useState<string>();
  const requestRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nodeElements = useRef(new Map<string, HTMLElement>());

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

  const visible = useMemo(
    () => visibleGraph(nodes, edges, expandedNodeIds, {
      traversal,
      rootNodeIds: viewRootId ? [viewRootId] : undefined,
    }),
    [nodes, edges, expandedNodeIds, traversal, viewRootId],
  );

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
    () => nodes.find((node) => node.id === viewRootId) ?? nodes.find((node) => !node.parentId),
    [nodes, viewRootId],
  );
  const baseDepth = rootNode?.depth ?? 0;

  const orderedNodes = useMemo(() => {
    const visibleIds = new Set(visible.nodes.map((node) => node.id));
    const outgoing = new Map<string, string[]>();
    for (const edge of visible.edges) {
      if (!activeRelationships.has(edge.relationshipType)) continue;
      const items = outgoing.get(edge.source) ?? [];
      items.push(edge.target);
      outgoing.set(edge.source, items);
    }
    const byId = new Map(visible.nodes.map((node) => [node.id, node]));
    const ordered: ConceptNode[] = [];
    const seen = new Set<string>();
    const queue = rootNode && visibleIds.has(rootNode.id) ? [rootNode.id] : visible.nodes.map((node) => node.id);
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const node = byId.get(id);
      if (node) ordered.push(node);
      const children = (outgoing.get(id) ?? [])
        .filter((childId) => visibleIds.has(childId))
        .sort((a, b) => (byId.get(a)?.title ?? "").localeCompare(byId.get(b)?.title ?? ""));
      queue.push(...children);
    }
    for (const node of visible.nodes) if (!seen.has(node.id)) ordered.push(node);
    return ordered;
  }, [visible.nodes, visible.edges, activeRelationships, rootNode]);

  const nodeLevel = useCallback((node: ConceptNode) => Math.max(0, node.depth - baseDepth), [baseDepth]);
  const maxLevel = useMemo(() => orderedNodes.reduce((max, node) => Math.max(max, nodeLevel(node)), 0), [orderedNodes, nodeLevel]);
  const activeIndex = Math.max(0, orderedNodes.findIndex((node) => node.id === activeNodeId));

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

  const resetGraph = useCallback(() => {
    requestRef.current?.abort();
    setNodes([]);
    setEdges([]);
    setLevels([]);
    setExpandedNodeIds(new Set());
    setSelectedNodeId(undefined);
    setFocusedNodeId(undefined);
    setViewRootId(undefined);
    setLearningPath(undefined);
    setTrace([]);
    setWarnings([]);
    setError(undefined);
    setExplanations({});
    setActiveNodeId(undefined);
    nodeElements.current.clear();
  }, []);

  const switchMode = useCallback((nextMode: PrimaryMode) => {
    setMode(nextMode);
    const anchor = selectedNodeId ?? activeNodeId ?? viewRootId;
    if (anchor) {
      setViewRootId(anchor);
      setFocusedNodeId(anchor);
      setExpandedNodeIds((current) => new Set([...current, anchor]));
      requestAnimationFrame(() => nodeElements.current.get(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }, [selectedNodeId, activeNodeId, viewRootId]);

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
        setActiveNodeId(root.id);
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
        setActiveNodeId(root.id);
        setViewRootId(root.id);
        setLearningPath(response.data.learningPath);
        setTrace(response.trace as AgentTraceEvent[]);
        setWarnings(response.warnings);
      }
      setExplanations({});
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }));
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
    requestAnimationFrame(() => nodeElements.current.get(nodeId)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function scrollToLevel(level: number) {
    const node = orderedNodes.find((item) => nodeLevel(item) === level);
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
    selectNode(nodeId, false);
    setMode(nextMode);
    setViewRootId(nodeId);
    setExpandedNodeIds((current) => new Set([...current, nodeId]));
    if (nextMode === "tree") {
      setTreeIntent("decompose");
      void expandNodeWithTraversal(nodeId, { mode: "tree", intent: "decompose" });
    } else {
      markKnown(nodeId);
      const nextIntent: BrickIntent = goal.trim() ? "destination" : "explore";
      setBrickIntent(nextIntent);
      void expandNodeWithTraversal(nodeId, { mode: "brick", intent: nextIntent });
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
    resetGraph();
    setMode("tree");
    setTreeIntent("decompose");
    setTopic(document.title || document.fileName);
    setProfile((current) => ({
      ...current,
      sourceMode: "prefer-uploaded",
      sourceDocumentIds: [document.id],
      purpose: current.purpose === "general-learning" ? "research" : current.purpose,
    }));
    setWarnings([`Source ready: ${document.title}. Tree will prefer evidence from this file.`]);
  }

  function startNewGraph() {
    resetGraph();
    setDocuments([]);
    setProfile(DEFAULT_PROFILE);
    setKnownInput("");
    setGoal("");
    setTopic("Machine Learning");
    setDrawerOpen(false);
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
  }), [mode, treeIntent, brickIntent, nodes, edges, levels, expandedNodeIds, selectedNodeId, focusedNodeId, viewRootId, goal, knownInput, topic, profile, documents, learningPath, trace, explanations]);

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
    setMode(saved.mode);
    setTreeIntent(saved.treeIntent);
    setBrickIntent(saved.brickIntent);
    setNodes(saved.nodes.map(migrateNode));
    setEdges(saved.edges);
    setLevels(saved.levels);
    setExpandedNodeIds(new Set(saved.expandedNodeIds));
    setSelectedNodeId(saved.selectedNodeId);
    setFocusedNodeId(saved.focusedNodeId);
    setActiveNodeId(saved.focusedNodeId ?? saved.selectedNodeId);
    setViewRootId(saved.viewRootId ?? saved.focusedNodeId ?? saved.selectedNodeId);
    setGoal(saved.goal);
    setKnownInput(saved.knownInput);
    setTopic(saved.topic);
    setProfile({ ...DEFAULT_PROFILE, ...saved.profile });
    setDocuments(saved.documents);
    setLearningPath(saved.learningPath);
    setTrace(saved.trace);
    setExplanations(saved.explanations as Record<string, AdaptiveExplanation>);
    setError(undefined);
    setWarnings([`Restored ${file.name}.`]);
    setPhase("workspace");
  }

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !orderedNodes.length) return;
    const observer = new IntersectionObserver((entries) => {
      const visibleEntry = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      const nodeId = (visibleEntry?.target as HTMLElement | undefined)?.dataset.nodeId;
      if (nodeId) {
        setActiveNodeId(nodeId);
        setFocusedNodeId(nodeId);
      }
    }, { root, threshold: [0.4, 0.62, 0.78] });

    for (const node of orderedNodes) {
      const element = nodeElements.current.get(node.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [orderedNodes]);

  if (phase === "landing") {
    return <Landing onBegin={(nextMode) => { setMode(nextMode); setPhase("workspace"); }} />;
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

      <AxisRail axis={modeAxis(mode)} maxLevel={maxLevel} activeLevel={orderedNodes.find((node) => node.id === activeNodeId) ? nodeLevel(orderedNodes.find((node) => node.id === activeNodeId)!) : 0} onSelect={scrollToLevel} />

      <div ref={scrollRef} className={styles.scrollCanvas}>
        {!orderedNodes.length ? (
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
        ) : orderedNodes.map((node, index) => {
          const level = nodeLevel(node);
          const explanation = explanations[node.id];
          const outgoing = visible.edges.filter((edge) => edge.source === node.id && activeRelationships.has(edge.relationshipType));
          const recommended = Boolean(learningPath?.recommendedTitle && learningPath.recommendedTitle === node.title);
          const distance = Math.min(4, Math.abs(index - activeIndex));
          const cardStyle = {
            "--node-delay": `${Math.min(index, 5) * 70}ms`,
            "--node-scale": Math.max(0.7, 1 - distance * 0.075),
            "--node-opacity": Math.max(0.5, 1 - distance * 0.13),
          } as CSSProperties;
          return (
            <section
              key={node.id}
              ref={(element) => {
                if (element) nodeElements.current.set(node.id, element);
                else nodeElements.current.delete(node.id);
              }}
              data-node-id={node.id}
              className={`${styles.nodeSection} ${index === 0 && mode === "brick" ? styles.brickRootSection : ""}`}
              style={cardStyle}
            >
              <KnowledgeNode
                node={node}
                mode={mode}
                level={level}
                startingDifficulty={rootNode?.difficulty ?? node.difficulty}
                selected={selectedNodeId === node.id}
                active={activeNodeId === node.id}
                recommended={recommended}
                recommendationReason={recommended ? learningPath?.recommendationReason : undefined}
                explanation={explanation}
                outgoing={outgoing}
                relatedNodes={nodes}
                generated={generatedNodeIds.has(node.id)}
                busy={loadingNodeId === node.id}
                busyLabel={loadingNodeId === node.id ? busyLabel : undefined}
                explanationLoading={explanationLoadingNodeId === node.id}
                resourceLoading={resourceLoadingNodeId === node.id}
                error={selectedNodeId === node.id ? error : undefined}
                warnings={selectedNodeId === node.id ? warnings : []}
                onSelect={(loadExplanation) => selectNode(node.id, loadExplanation)}
                onContinue={() => { selectNode(node.id, false); void expandNode(node.id); }}
                onFindResources={() => void findResources(node.id)}
                onMarkKnown={() => markKnown(node.id)}
                onTreeFromHere={() => branchFromNode(node.id, "tree")}
                onBrickFromHere={() => branchFromNode(node.id, "brick")}
                onDismissMessages={() => { setError(undefined); setWarnings([]); }}
              />
            </section>
          );
        })}
      </div>

      <NavigatorDrawer
        open={drawerOpen}
        mode={mode}
        nodes={orderedNodes}
        edges={visible.edges}
        baseDepth={baseDepth}
        activeNodeId={activeNodeId}
        hasSession={Boolean(nodes.length || documents.length)}
        onClose={() => setDrawerOpen(false)}
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
        <article><strong>Tree</strong><p>Break a concept into parts, trace what comes before it, or unpack an open question.</p></article>
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

function AxisRail({ axis, maxLevel, activeLevel, onSelect }: {
  axis: "Depth" | "Height";
  maxLevel: number;
  activeLevel: number;
  onSelect: (level: number) => void;
}) {
  return (
    <aside className={styles.axisRail} aria-label={`${axis} levels`}>
      <span>{axis}</span>
      <div>
        {Array.from({ length: maxLevel + 1 }, (_, level) => (
          <button key={level} type="button" className={activeLevel === level ? styles.axisActive : ""} onClick={() => onSelect(level)}>
            <i />{level}
          </button>
        ))}
      </div>
    </aside>
  );
}

function Buffer({ label }: { label?: string }) {
  return (
    <div className={styles.buffer} role="status" aria-live="polite">
      <div className={styles.bufferTrack}><i /><i /><i /><i /></div>
      <span>{label || "Agents are building the next layer…"}</span>
    </div>
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
      <p className={styles.levelReason}>0 is your reference point. Every later depth or height is measured from what you put here.</p>

      <form className={styles.setupForm} onSubmit={onGenerate}>
        {mode === "tree" ? (
          <>
            <label>Tree action
              <select value={treeIntent} onChange={(event) => onTreeIntentChange(event.target.value as TreeIntent)}>
                <option value="decompose">Break down</option>
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
        <button type="submit" className={styles.primaryAction} disabled={Boolean(busyLabel)}>{busyLabel ? "Building…" : mode === "tree" ? TREE_INTENT_COPY[treeIntent].action : "Build Brick"}</button>
      </form>
    </article>
  );
}

function KnowledgeNode({
  node,
  mode,
  level,
  startingDifficulty,
  selected,
  active,
  recommended,
  recommendationReason,
  explanation,
  outgoing,
  relatedNodes,
  generated,
  busy,
  busyLabel,
  explanationLoading,
  resourceLoading,
  error,
  warnings,
  onSelect,
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
  startingDifficulty: number;
  selected: boolean;
  active: boolean;
  recommended: boolean;
  recommendationReason?: string;
  explanation?: AdaptiveExplanation;
  outgoing: ConceptEdge[];
  relatedNodes: ConceptNode[];
  generated: boolean;
  busy: boolean;
  busyLabel?: string;
  explanationLoading: boolean;
  resourceLoading: boolean;
  error?: string;
  warnings: string[];
  onSelect: (loadExplanation: boolean) => void;
  onContinue: () => void;
  onFindResources: () => void;
  onMarkKnown: () => void;
  onTreeFromHere: () => void;
  onBrickFromHere: () => void;
  onDismissMessages: () => void;
}) {
  const axis = modeAxis(mode);
  const connectionNames = outgoing.map((edge) => {
    const target = relatedNodes.find((candidate) => candidate.id === edge.target);
    return target ? `${connectionLabel(edge.relationshipType)} ${target.title}` : connectionLabel(edge.relationshipType);
  });

  return (
    <article className={`${styles.knowledgeNode} ${active ? styles.nodeActive : ""} ${selected ? styles.nodeSelected : ""}`} onClick={() => onSelect(false)}>
      <div className={styles.nodeMeta}>
        <span>{axis} {level}</span>
        <b>{level === 0 ? "Starting point" : mode === "tree" ? "More foundational" : "Builds further"}</b>
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
      <p className={styles.levelReason}>{nodeLevelReason(mode, level, node, startingDifficulty)}</p>
      {recommendationReason ? <p className={styles.recommendation}>{recommendationReason}</p> : null}

      {busy ? <Buffer label={busyLabel} /> : null}
      {error || warnings.length ? (
        <div className={styles.nodeNotice}>
          <span>{[error, ...warnings].filter(Boolean).join(" ")}</span>
          <button type="button" onClick={(event) => { event.stopPropagation(); onDismissMessages(); }}>×</button>
        </div>
      ) : null}

      <details className={styles.nodeDetails} onToggle={(event) => { if (event.currentTarget.open) onSelect(true); }} onClick={(event) => event.stopPropagation()}>
        <summary>{explanationLoading ? "Building detail…" : "More detail + resources"}</summary>
        <div className={styles.detailBody}>
          <section>
            <h3>Explanation</h3>
            <p>{explanation?.explanation || node.detailedExplanation || node.difficultyExplanation}</p>
            {explanation?.example ? <div className={styles.example}><strong>Example</strong><p>{explanation.example}</p></div> : null}
            {explanation?.keyTakeaway ? <div className={styles.takeaway}>{explanation.keyTakeaway}</div> : null}
          </section>

          {node.whyItMatters ? <section><h3>Why it matters</h3><p>{node.whyItMatters}</p></section> : null}

          <div className={styles.detailGrid}>
            <section><h3>Prerequisites</h3>{node.prerequisites.length ? <ul>{node.prerequisites.slice(0, 6).map((item) => <li key={item}>{item}</li>)}</ul> : <p>None listed yet.</p>}</section>
            <section><h3>What it unlocks</h3>{node.whatItUnlocks?.length ? <ul>{node.whatItUnlocks.slice(0, 6).map((item) => <li key={item}>{item}</li>)}</ul> : <p>Continue from this node to find out.</p>}</section>
          </div>

          {connectionNames.length ? <section><h3>Connections in this map</h3><div className={styles.connectionChips}>{connectionNames.map((label) => <span key={label}>{label}</span>)}</div></section> : null}

          <section>
            <div className={styles.resourceHeader}><h3>Resources</h3><button type="button" onClick={onFindResources} disabled={resourceLoading}>{resourceLoading ? "Finding…" : node.resources.length ? "Refresh" : "Find resources"}</button></div>
            {node.resources.length ? (
              <div className={styles.resources}>{node.resources.map((resource) => <a key={resource.url} href={resource.url} target="_blank" rel="noreferrer"><strong>{resource.title}</strong><span>{resource.source} · {resource.type}</span></a>)}</div>
            ) : <p>Resources are loaded only when you ask for them.</p>}
          </section>

          <div className={styles.secondaryActions}>
            {node.knowledgeStatus !== "known" ? <button type="button" onClick={onMarkKnown}>Mark known</button> : null}
            <button type="button" onClick={onTreeFromHere}>Tree from here</button>
            <button type="button" onClick={onBrickFromHere}>Brick from here</button>
          </div>
        </div>
      </details>

      <button type="button" className={styles.continueButton} onClick={(event) => { event.stopPropagation(); onContinue(); }} disabled={busy}>
        {busy ? "Building…" : generated ? "Show next nodes" : mode === "tree" ? "Continue downward" : "Continue upward"}
        <span aria-hidden="true">↓</span>
      </button>
    </article>
  );
}

function NavigatorDrawer({
  open,
  mode,
  nodes,
  edges,
  baseDepth,
  activeNodeId,
  hasSession,
  onClose,
  onTeleport,
  onDownload,
  onNew,
}: {
  open: boolean;
  mode: PrimaryMode;
  nodes: ConceptNode[];
  edges: ConceptEdge[];
  baseDepth: number;
  activeNodeId?: string;
  hasSession: boolean;
  onClose: () => void;
  onTeleport: (id: string) => void;
  onDownload: () => void;
  onNew: () => void;
}) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return (
    <aside className={`${styles.navigator} ${open ? styles.navigatorOpen : ""}`} aria-hidden={!open}>
      <header><strong>{mode === "tree" ? "Tree map" : "Brick map"}</strong><button type="button" onClick={onClose}>×</button></header>
      <div className={styles.mapTable}>
        <div className={styles.mapHead}><span>{modeAxis(mode)}</span><span>Node</span><span>Connects</span></div>
        {nodes.length ? nodes.map((node) => {
          const outgoing = edges.filter((edge) => edge.source === node.id);
          return (
            <button key={node.id} type="button" className={node.id === activeNodeId ? styles.mapRowActive : ""} onClick={() => onTeleport(node.id)}>
              <span>{Math.max(0, node.depth - baseDepth)}</span>
              <strong>{node.title}</strong>
              <small>{outgoing.length ? outgoing.map((edge) => nodeById.get(edge.target)?.title).filter(Boolean).join(", ") : "—"}</small>
            </button>
          );
        }) : <p className={styles.emptyMap}>Your map will appear here.</p>}
      </div>
      <footer>
        <button type="button" onClick={onNew}>New map</button>
        <button type="button" disabled={!hasSession} onClick={onDownload}>Download session</button>
      </footer>
    </aside>
  );
}
