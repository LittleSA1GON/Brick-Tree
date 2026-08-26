"use client";

import { type CSSProperties, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConceptEdge, ConceptNode, GraphLevelDescriptor, ResourceLink } from "@/lib/schemas/concept";
import type { ExtractedDocument } from "@/lib/schemas/documents";
import type { LearnerProfile as LearnerProfileType, LearningPathProposal } from "@/lib/schemas/learning-path";
import type { BrickIntent, LearningTraversal, TreeIntent } from "@/lib/schemas/session";
import type { PedagogyValidation } from "@/lib/schemas/validation";
import type { ExplanationLevel } from "@/lib/schemas/api";
import type { AgentTraceEvent } from "@/lib/observability/trace";
import { callAgent } from "@/lib/utils/api-client";
import { graphContextFromState } from "@/lib/graph/graph-utils";
import { hasGeneratedTraversalNeighbors, mergeGraphPatch, traversalRelationships, visibleGraph } from "@/lib/graph/client-state";
import { ConceptGraph } from "@/components/graph/ConceptGraph";
import { GraphBreadcrumbs } from "@/components/graph/GraphBreadcrumbs";
import type { ViewportIntent } from "@/components/graph/GraphViewportController";
import { NodeDetailPanel, type AdaptiveExplanation } from "@/components/node/NodeDetailPanel";
import { AgentActivity } from "@/components/agents/AgentActivity";
import { LearnerProfile } from "@/components/learning/LearnerProfile";
import { RecommendationPanel } from "@/components/learning/RecommendationPanel";
import { DocumentSources } from "@/components/learning/DocumentSources";
import { normalizeConceptTitle } from "@/lib/utils/text";
import { SessionTransfer } from "@/components/session/SessionTransfer";
import { createPortableSessionFile, parsePortableSessionFile, safeSessionFileName, type PortableSessionState } from "@/lib/schemas/session-file";

type PrimaryMode = "tree" | "brick";
const TREE_INTENT_COPY: Record<TreeIntent, { title: string; subtitle: string; prompt: string; placeholder: string; action: string; busy: string }> = {
  decompose: {
    title: "Break Down",
    subtitle: "What is this made of?",
    prompt: "What do you want to break down?",
    placeholder: "e.g. Machine Learning",
    action: "Break it down",
    busy: "Breaking the concept into coherent parts…",
  },
  "trace-prerequisites": {
    title: "Trace to Roots",
    subtitle: "What do I need to understand first?",
    prompt: "What do you want to trace to its roots?",
    placeholder: "e.g. Backpropagation",
    action: "Trace roots",
    busy: "Tracing prerequisite roots…",
  },
  "analyze-question": {
    title: "Analyze a Question",
    subtitle: "Who, what, why, where, and how shape this?",
    prompt: "What open-ended question do you want to unpack?",
    placeholder: "e.g. How do I stay valuable as a software engineer in an AI-heavy future?",
    action: "Map the question",
    busy: "Mapping the question through multiple reasoning lenses…",
  },
};

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

function pathIds(nodes: ConceptNode[], nodeId: string): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const result: string[] = [];
  let current = byId.get(nodeId);
  while (current) {
    result.unshift(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return result;
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
  if (level === "novice") return "simple";
  return level;
}

export function BrickTreeApp() {
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
  const [resourceLoading, setResourceLoading] = useState(false);
  const [explanationLoading, setExplanationLoading] = useState(false);
  const [explanations, setExplanations] = useState<Record<string, AdaptiveExplanation>>({});
  const [viewportIntent, setViewportIntent] = useState<ViewportIntent>(null);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  // Learner knowledge is shared across Tree and Brick. Mark matching graph nodes as known
  // without deleting historical knowledge when the free-form input is edited later.
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

  const visible = useMemo(() => visibleGraph(nodes, edges, expandedNodeIds, { traversal, rootNodeIds: viewRootId ? [viewRootId] : undefined }), [nodes, edges, expandedNodeIds, traversal, viewRootId]);
  const activeRelationships = useMemo(() => traversalRelationships(traversal), [traversal]);
  const generatedNodeIds = useMemo(() => new Set(edges.filter((edge) => activeRelationships.has(edge.relationshipType)).map((edge) => edge.source)), [edges, activeRelationships]);
  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId), [nodes, selectedNodeId]);
  const relatedConcepts = useMemo(() => {
    if (!selectedNodeId) return [];
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const seen = new Set<string>();
    const result: Array<{ id: string; title: string; relationshipType: ConceptEdge["relationshipType"] }> = [];
    for (const edge of edges) {
      const otherId = edge.source === selectedNodeId ? edge.target : edge.target === selectedNodeId ? edge.source : undefined;
      if (!otherId) continue;
      const other = byId.get(otherId);
      const key = `${otherId}:${edge.relationshipType}`;
      if (!other || seen.has(key)) continue;
      seen.add(key);
      result.push({ id: other.id, title: other.title, relationshipType: edge.relationshipType });
    }
    return result;
  }, [nodes, edges, selectedNodeId]);
  const rootNode = useMemo(() => nodes.find((node) => !node.parentId), [nodes]);
  const viewRootNode = useMemo(() => nodes.find((node) => node.id === viewRootId) ?? rootNode, [nodes, viewRootId, rootNode]);
  const currentExplanation = selectedNode ? explanations[selectedNode.id] : undefined;
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
    const contextualLearningGoal = profile.learningGoal?.trim() || undefined;
    const availableDocumentIds = new Set(documents.map((document) => document.id));
    const selectedDocumentIds = (profile.sourceDocumentIds ?? []).filter((id) => availableDocumentIds.has(id));
    return {
      ...profile,
      existingKnowledge: known,
      // `goal` is reserved for Brick Destination. `learningGoal` is optional
      // session context that may steer pedagogy without turning Explore into Destination.
      goal: activeDestination,
      learningGoal: contextualLearningGoal,
      sourceDocumentIds: selectedDocumentIds,
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
    setViewportIntent(null);
  }, []);

  async function generateInitial(event?: FormEvent) {
    event?.preventDefault();
    const label = mode === "tree"
      ? TREE_INTENT_COPY[treeIntent].busy
      : brickIntent === "explore" ? "Mapping reachable next bricks…" : "Ranking paths toward your destination…";
    const controller = beginRequest(label);
    try {
      const knownConcepts = parseKnownConcepts(knownInput);
      const nextProfile = syncedProfile(knownConcepts, { includeGoal: mode === "brick" && brickIntent === "destination" });
      setProfile(nextProfile);

      if (mode === "tree") {
        if (topic.trim().length < 2) throw new Error(treeIntent === "analyze-question" ? "Enter a question for Tree mode." : "Enter a concept for Tree mode.");
        const response = await callAgent<TreeData>({
          action: "navigate",
          traversal,
          topic: topic.trim(),
          learnerProfile: nextProfile,
          documents: agentDocuments,
        }, controller.signal);
        const root = response.data?.root ?? response.data?.parent;
        if (!response.data || !root) throw new Error("Brick Tree returned no concept graph.");
        setNodes([migrateNode(root), ...response.data.nodes.map(migrateNode)]);
        setEdges(response.data.edges);
        setLevels(uniqueLevels([root.level, response.data.level]));
        setExpandedNodeIds(new Set([root.id]));
        setSelectedNodeId(root.id);
        setFocusedNodeId(root.id);
        setViewRootId(root.id);
        setLearningPath(undefined);
        setTrace(response.trace as AgentTraceEvent[]);
        setWarnings(response.warnings);
        setViewportIntent({ type: "fit-all", nonce: Date.now() });
      } else {
        if (!knownConcepts.length) throw new Error("Tell Brick Tree at least one thing you already know.");
        if (brickIntent === "destination" && !goal.trim()) throw new Error("Destination mode needs a goal.");
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
        setViewportIntent({ type: "fit-all", nonce: Date.now() });
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
      setViewportIntent({ type: "fit-branch", rootNodeId: nodeId, nonce: Date.now() });
      return;
    }

    if (nextTraversal.mode === "tree" && nextTraversal.intent === "trace-prerequisites" && node.knowledgeStatus === "known") {
      setWarnings([`You already marked ${node.title} as understood. Tree can stop here; switch to Brick to build upward from this point.`]);
      return;
    }

    const controller = beginRequest(
      nextTraversal.mode === "tree"
        ? nextTraversal.intent === "decompose"
          ? `Breaking down ${node.title}…`
          : nextTraversal.intent === "analyze-question"
            ? `Analyzing ${node.title} as a question lens…`
            : `Tracing roots beneath ${node.title}…`
        : `Building upward from ${node.title}…`,
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
      if (!response.data) throw new Error("No graph patch returned.");

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
      setViewportIntent({ type: "fit-branch", rootNodeId: nodeId, nonce: Date.now() });
    } catch (requestError) {
      if ((requestError as Error).name !== "AbortError") setError((requestError as Error).message);
    } finally {
      setLoadingNodeId(undefined);
      endRequest();
    }
  }, [nodes, edges, levels, goal, agentDocuments, beginRequest, endRequest, hasGeneratedFor, syncedProfile]);

  const expandNode = useCallback((nodeId: string) => expandNodeWithTraversal(nodeId, traversal), [expandNodeWithTraversal, traversal]);

  const collapseNode = useCallback((nodeId: string) => {
    setExpandedNodeIds((current) => {
      const next = new Set(current);
      next.delete(nodeId);
      return next;
    });
    setViewportIntent({ type: "focus-node", nodeId, nonce: Date.now() });
  }, []);

  async function explainNode(nodeId: string, level: ExplanationLevel) {
    const node = nodes.find((item) => item.id === nodeId);
    if (!node) return;
    setExplanationLoading(true);
    setError(undefined);
    try {
      const response = await callAgent<AdaptiveExplanation>({
        action: "explain",
        node,
        level,
        learnerProfile: syncedProfile(undefined, { includeGoal: mode === "brick" && brickIntent === "destination" }),
        documents: agentDocuments,
      });
      if (!response.data) throw new Error("No adapted explanation returned.");
      setExplanations((current) => ({ ...current, [node.id]: response.data! }));
      setTrace((current) => [...current, ...(response.trace as AgentTraceEvent[])].slice(-100));
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setExplanationLoading(false);
    }
  }

  const selectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setFocusedNodeId(nodeId);
    setViewportIntent({ type: "focus-node", nodeId, nonce: Date.now() });
    if (!explanations[nodeId]) void explainNode(nodeId, explanationLevel(profile));
  // explainNode is intentionally invoked from the current render state rather than memoized into this callback.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explanations, profile]);

  const goRoot = useCallback(() => {
    if (!viewRootNode) return;
    setSelectedNodeId(viewRootNode.id);
    setFocusedNodeId(viewRootNode.id);
    setViewportIntent({ type: "show-overview", nonce: Date.now() });
  }, [viewRootNode]);

  async function findResources() {
    if (!selectedNode) return;
    setResourceLoading(true);
    setError(undefined);
    try {
      const response = await callAgent<ResourceData>({
        action: "resources",
        node: selectedNode,
        learnerProfile: syncedProfile(undefined, { includeGoal: mode === "brick" && brickIntent === "destination" }),
        documents: agentDocuments,
      });
      if (!response.data) throw new Error("No resource response returned.");
      setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, resources: response.data!.resources } : node));
      setTrace((current) => [...current, ...(response.trace as AgentTraceEvent[])].slice(-100));
      setWarnings(response.warnings);
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setResourceLoading(false);
    }
  }

  async function explain(level: ExplanationLevel) {
    if (selectedNode) await explainNode(selectedNode.id, level);
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

  function breakDownSelected() {
    if (!selectedNode) return;
    setMode("tree");
    setTreeIntent("decompose");
    setViewRootId(selectedNode.id);
    setExpandedNodeIds((current) => new Set([...current, selectedNode.id]));
    void expandNodeWithTraversal(selectedNode.id, { mode: "tree", intent: "decompose" });
  }

  function traceRootsSelected() {
    if (!selectedNode) return;
    setMode("tree");
    setTreeIntent("trace-prerequisites");
    setViewRootId(selectedNode.id);
    setExpandedNodeIds((current) => new Set([...current, selectedNode.id]));
    void expandNodeWithTraversal(selectedNode.id, { mode: "tree", intent: "trace-prerequisites" });
  }

  function buildFromSelected() {
    if (!selectedNode) return;
    markKnown(selectedNode.id);
    setMode("brick");
    setViewRootId(selectedNode.id);
    setExpandedNodeIds((current) => new Set([...current, selectedNode.id]));
    const nextIntent: BrickIntent = goal.trim() ? "destination" : "explore";
    setBrickIntent(nextIntent);
    void expandNodeWithTraversal(selectedNode.id, { mode: "brick", intent: nextIntent });
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
    setWarnings([`Source ready: ${document.title}. Brick Tree will map its concepts with uploaded evidence preferred.`]);
  }

  function startNewGraph() {
    resetGraph();
    setDocuments([]);
    setProfile(DEFAULT_PROFILE);
    setKnownInput("");
    setGoal("");
    setTopic("Machine Learning");
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
    const state = buildPortableState();
    const session = createPortableSessionFile(state);
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
    const imported = parsePortableSessionFile(parsedJson);
    const saved = imported.state;
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
    setWarnings([`Portable session restored from ${file.name}. Nothing was loaded from persistent server storage.`]);
    setViewportIntent({ type: "fit-all", nonce: Date.now() });
  }

  const selectedPathIds = selectedNodeId ? pathIds(nodes, selectedNodeId) : [];
  const modeLabel = mode === "tree"
    ? `Tree · ${TREE_INTENT_COPY[treeIntent].title}`
    : brickIntent === "explore" ? "Brick · Explore" : "Brick · Destination";

  return (
    <main className="app-shell">
      <header className="topbar">
        <button type="button" className="brand-lockup" onClick={startNewGraph} aria-label="Brick Tree home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span><strong>Brick Tree</strong><small>Knowledge navigation</small></span>
        </button>
        <div className="topbar-right">
          {nodes.length ? <>
            <button type="button" className="ghost-button" onClick={downloadSession}>Download session</button>
            <button type="button" className="ghost-button" onClick={startNewGraph}>New graph</button>
          </> : null}
          <span className="architecture-chip">Stateless Vercel runtime · 4 agents</span>
        </div>
      </header>

      <section className={`hero ${nodes.length ? "hero-compact" : ""}`}>
        <div className="hero-copy">
          <span className="hero-kicker ui-enter-up">
            Tree turns complexity into foundations. Brick turns foundations into possibilities.
          </span>
          <h1 className="ui-enter-up ui-delay-1">
            Break down what you <span>don&apos;t understand.</span><br />Build up what you do.
          </h1>
          {!nodes.length ? (
            <p className="ui-enter ui-delay-2">
              Navigate one shared knowledge graph—break apart a concept, unpack a strategic question, trace prerequisite roots, or build upward from what you already know.
            </p>
          ) : null}
        </div>
        {!nodes.length ? <HeroTreePreview /> : null}
      </section>

      <section className="command-card">
        <div className="mode-switch" role="tablist" aria-label="Knowledge direction">
          <button type="button" className={mode === "tree" ? "active" : ""} onClick={() => { setMode("tree"); if (selectedNodeId) { setViewRootId(selectedNodeId); setExpandedNodeIds((current) => new Set([...current, selectedNodeId])); } }}>
            <span>↓</span><strong>Tree</strong><small>Break down what you don&apos;t understand</small>
          </button>
          <button type="button" className={mode === "brick" ? "active" : ""} onClick={() => { setMode("brick"); if (selectedNodeId) { setViewRootId(selectedNodeId); setExpandedNodeIds((current) => new Set([...current, selectedNodeId])); } }}>
            <span>↑</span><strong>Brick</strong><small>Build up what you already know</small>
          </button>
        </div>

        <div className="intent-switch" role="tablist" aria-label="Learning intent">
          {mode === "tree" ? (
            <>
              {(Object.entries(TREE_INTENT_COPY) as Array<[TreeIntent, (typeof TREE_INTENT_COPY)[TreeIntent]]>).map(([intent, copy]) => (
                <button type="button" key={intent} className={treeIntent === intent ? "active" : ""} onClick={() => { setTreeIntent(intent); if (selectedNodeId) setViewRootId(selectedNodeId); }}>
                  <strong>{copy.title}</strong><small>{copy.subtitle}</small>
                </button>
              ))}
            </>
          ) : (
            <>
              <button type="button" className={brickIntent === "explore" ? "active" : ""} onClick={() => { setBrickIntent("explore"); if (selectedNodeId) setViewRootId(selectedNodeId); }}>
                <strong>Explore</strong><small>What can I build from here?</small>
              </button>
              <button type="button" className={brickIntent === "destination" ? "active" : ""} onClick={() => { setBrickIntent("destination"); if (selectedNodeId) setViewRootId(selectedNodeId); }}>
                <strong>Destination</strong><small>How can I build toward this?</small>
              </button>
            </>
          )}
        </div>

        <form onSubmit={generateInitial} className="command-form">
          {mode === "tree" ? (
            <div className="tree-inputs">
              <label className="primary-input">
                <span>{TREE_INTENT_COPY[treeIntent].prompt}</span>
                <div>
                  <input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder={TREE_INTENT_COPY[treeIntent].placeholder} />
                  <button type="submit" disabled={Boolean(busyLabel)}>{busyLabel ? "Building…" : TREE_INTENT_COPY[treeIntent].action}</button>
                </div>
              </label>
              {treeIntent === "trace-prerequisites" ? (
                <label className="secondary-known-input">
                  <span>What do you already understand? <em>optional stopping points</em></span>
                  <input value={knownInput} onChange={(event) => setKnownInput(event.target.value)} placeholder="e.g. Algebra, derivatives" />
                </label>
              ) : null}
            </div>
          ) : (
            <div className="discover-inputs">
              <label>
                <span>What do you already know?</span>
                <textarea value={knownInput} onChange={(event) => setKnownInput(event.target.value)} rows={2} placeholder="Algebra, geometry, Python…" />
              </label>
              {brickIntent === "destination" ? (
                <label>
                  <span>What do you want to build toward?</span>
                  <input value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="e.g. Understand machine learning" />
                </label>
              ) : null}
              <button type="submit" disabled={Boolean(busyLabel)}>{busyLabel ? "Mapping…" : brickIntent === "explore" ? "Explore branches" : "Build toward goal"}</button>
            </div>
          )}
        </form>

        <LearnerProfile
          profile={profile}
          onChange={setProfile}
        />
        <DocumentSources
          documents={documents}
          activeDocumentIds={new Set(profile.sourceDocumentIds)}
          sourceMode={profile.sourceMode ?? "general"}
          onAdd={addDocument}
          onRemove={removeDocument}
          onToggleActive={toggleDocumentSource}
          onUseAsTopic={useDocumentAsTopic}
        />
        <SessionTransfer
          hasSession={Boolean(nodes.length || documents.length)}
          onDownload={downloadSession}
          onUpload={uploadSession}
        />
      </section>

      {error ? (
        <div className="notice notice-error ui-enter-up">
          <strong>Couldn&apos;t complete that step.</strong><span>{error}</span><button type="button" onClick={() => setError(undefined)}>Dismiss</button>
        </div>
      ) : null}
      {warnings.length ? (
        <div className="notice notice-warning ui-enter">
          <strong>Review note</strong><span>{warnings.join(" ")}</span><button type="button" onClick={() => setWarnings([])}>Dismiss</button>
        </div>
      ) : null}

      {nodes.length ? (
        <>
          <RecommendationPanel path={mode === "brick" ? learningPath : undefined} intent={brickIntent} />
          <GraphBreadcrumbs nodes={nodes} selectedId={selectedNodeId} onSelect={selectNode} />
          <section className="workspace-grid">
            <div className="graph-stage">
              <div className="graph-stage-meta">
                <div>
                  <span className="eyebrow">{modeLabel}</span>
                  <strong>{visible.nodes.length} visible bricks · {levels.length} difficulty layers</strong>
                </div>
                <div className="path-mini" title="Current learning path">
                  {selectedPathIds.map((id) => <span key={id} />)}
                </div>
              </div>
              <ConceptGraph
                nodes={visible.nodes}
                edges={visible.edges}
                axis={mode === "tree" ? "depth" : "height"}
                traversal={traversal}
                generatedNodeIds={generatedNodeIds}
                selectedNodeId={selectedNodeId}
                focusedNodeId={focusedNodeId}
                expandedNodeIds={expandedNodeIds}
                loadingNodeId={loadingNodeId}
                recommendedTitle={mode === "brick" ? learningPath?.recommendedTitle : undefined}
                viewportIntent={viewportIntent}
                onSelect={selectNode}
                onExpand={(id) => void expandNode(id)}
                onCollapse={collapseNode}
                onRoot={goRoot}
              />
              <div className="difficulty-legend" aria-label="Difficulty scale">
                {[1, 2, 3, 4, 5].map((score) => <span key={score}><i className={`difficulty-dot d${score}`} />D{score}</span>)}
              </div>
              <div className="knowledge-legend" aria-label="Knowledge status">
                <span>● known</span><span>◆ available</span><span>★ recommended</span><span>○ future</span><span>△ missing root</span>
              </div>
            </div>
            <NodeDetailPanel
              node={selectedNode}
              explanation={currentExplanation}
              resourceLoading={resourceLoading}
              explanationLoading={explanationLoading}
              onFindResources={() => void findResources()}
              onExplain={(level) => void explain(level)}
              onBreakDown={breakDownSelected}
              onTraceRoots={traceRootsSelected}
              onBuildFromHere={buildFromSelected}
              onMarkKnown={() => selectedNode && markKnown(selectedNode.id)}
              relatedConcepts={relatedConcepts}
              onSelectRelated={selectNode}
              preferredExplanationLevel={explanationLevel(profile)}
            />
          </section>
          <AgentActivity trace={trace} activeLabel={busyLabel} />
        </>
      ) : (
        <section className="empty-explainer">
          <div><span>01</span><h2>Separate the intent</h2><p>Tree can decompose concepts, trace prerequisites, or analyze open-ended questions through multiple lenses. Brick can explore possibilities or build toward a destination.</p></div>
          <div><span>02</span><h2>Share the graph</h2><p>Every intent uses the same typed nodes, semantic edges, difficulty layers, learner state, agent runtime, and animation system.</p></div>
          <div><span>03</span><h2>Move one brick at a time</h2><p>Expand only the concept you need. Tree travels toward roots; Brick grows upward from established knowledge.</p></div>
        </section>
      )}

      <footer className="footer-note">
        <span>Brick Tree</span>
        <p>AI-generated learning structures are navigational aids, not authoritative curricula. Difficulty is approximate and explained. Uploaded-source claims retain explicit provenance.</p>
      </footer>
    </main>
  );
}

function HeroTreePreview() {
  const previewNodes = [
    { label: "Machine Learning", className: "preview-root", delay: 0 },
    { label: "Linear Algebra", className: "preview-child a", delay: 0.12 },
    { label: "Probability", className: "preview-child b", delay: 0.2 },
    { label: "Optimization", className: "preview-child c", delay: 0.28 },
    { label: "Algebra", className: "preview-leaf a", delay: 0.38 },
    { label: "Functions", className: "preview-leaf b", delay: 0.44 },
  ];
  return (
    <div className="hero-tree" aria-hidden="true">
      <svg viewBox="0 0 500 330" className="hero-tree-lines">
        <path d="M250 62 C250 105 140 105 140 148" />
        <path d="M250 62 C250 105 250 105 250 148" />
        <path d="M250 62 C250 105 360 105 360 148" />
        <path d="M140 190 C140 235 190 225 190 270" />
        <path d="M250 190 C250 235 285 225 285 270" />
      </svg>
      {previewNodes.map((node) => (
        <div
          key={node.label}
          className={`hero-preview-node ${node.className}`}
          style={{
            "--enter-delay": `${node.delay}s`,
            "--float-duration": `${6 + node.delay * 2}s`,
          } as CSSProperties}
        >
          {node.label}
        </div>
      ))}
      <div className="hero-tree-caption"><span>harder / more integrated</span><i /><span>easier / foundational</span></div>
    </div>
  );
}
