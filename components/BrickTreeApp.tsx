"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConceptEdge, ConceptNode, GraphLevelDescriptor } from "@/lib/schemas/concept";
import type { ExtractedDocument } from "@/lib/schemas/documents";
import type { LearnerProfile as LearnerProfileType, LearningPathProposal } from "@/lib/schemas/learning-path";
import type { BrickIntent, LearningTraversal, TreeIntent } from "@/lib/schemas/session";
import type { AdaptiveExplanation, ExplanationLevel } from "@/lib/schemas/api";
import type { AgentTraceEvent } from "@/lib/observability/trace";
import { callAgent } from "@/lib/utils/api-client";
import { graphContextFromState } from "@/lib/graph/graph-utils";
import { hasGeneratedTraversalNeighbors, mergeGraphPatch, traversalRelationships } from "@/lib/graph/client-state";
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
import {
  DEFAULT_PROFILE,
  TREE_INTENT_COPY,
  explanationLearnerProfile,
  explanationLevel,
  explanationNodeContext,
  migrateNode,
  modeAxis,
  parseKnownConcepts,
  uniqueLevels,
  type BrickData,
  type ExperiencePhase,
  type PrimaryMode,
  type TreeData,
  type WorkspaceSnapshot,
} from "@/components/brick-tree/model";
import { AxisRail, BrandIcon, Landing, ModeDock, ZoomControls } from "@/components/brick-tree/shell";
import { HierarchyStage } from "@/components/brick-tree/hierarchy";
import { SetupNode } from "@/components/brick-tree/setup";
import { NavigatorDrawer, PersistentMiniMap } from "@/components/brick-tree/navigation";
import { useResourceHydration } from "@/components/brick-tree/useResourceHydration";
import styles from "./BrickTreeApp.module.css";

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
  const [explanationLoadingNodeId, setExplanationLoadingNodeId] = useState<string>();
  const [explanations, setExplanations] = useState<Record<string, AdaptiveExplanation>>({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [graphZoom, setGraphZoom] = useState(1);
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

  const { hydrateResources, resourceLoadingNodeIds } = useResourceHydration({
    activeWorkspaceId,
    setNodes,
    setTrace,
    setWarnings,
  });

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
        const initialNodes = [migratedRoot, ...response.data.nodes.map(migrateNode)];
        setNodes(initialNodes);
        void hydrateResources(initialNodes, nextProfile);
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
        if (!knownInput.trim()) throw new Error("Add what you already understand, even if it is a sentence or says you are starting from scratch.");
        if (brickIntent === "destination" && !goal.trim()) throw new Error("Add a destination first.");
        const response = await callAgent<BrickData>({
          action: "navigate",
          traversal,
          knownConcepts,
          rawKnowledgeInput: knownInput.trim(),
          goal: brickIntent === "destination" ? goal.trim() : undefined,
          learnerProfile: nextProfile,
          documents: agentDocuments,
        }, controller.signal);
        if (!response.data?.root) throw new Error("Brick Tree returned no learning path.");
        const root = migrateNode(response.data.root);
        const initialNodes = [root, ...response.data.nodes.map(migrateNode)];
        setNodes(initialNodes);
        void hydrateResources(initialNodes, nextProfile);
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
        node: { ...node, resources: [], detailedExplanation: undefined },
        graphContext: graphContextFromState(nodes, levels, nodeId),
        goal: nextTraversal.mode === "brick" && nextTraversal.intent === "destination" ? goal.trim() || undefined : undefined,
        learnerProfile: nextProfile,
        documents: agentDocuments,
      }, controller.signal);
      if (!response.data) throw new Error("No graph update returned.");

      const data = response.data;
      const parent = migrateNode(("parent" in data && data.parent) ? data.parent : node);
      const incomingNodes = data.nodes.map(migrateNode);
      const patch = mergeGraphPatch(nodes, edges, parent, incomingNodes, data.edges);
      setNodes(patch.nodes);
      void hydrateResources([parent, ...incomingNodes], nextProfile);
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
  }, [nodes, edges, levels, goal, agentDocuments, beginRequest, endRequest, hasGeneratedFor, syncedProfile, hydrateResources]);

  const expandNode = useCallback(
    (nodeId: string) => expandNodeWithTraversal(nodeId, traversal),
    [expandNodeWithTraversal, traversal],
  );

  async function explainNode(nodeId: string, level: ExplanationLevel) {
    const node = nodes.find((item) => item.id === nodeId);
    if (!node || explanations[nodeId]?.level === level) return;
    setExplanationLoadingNodeId(nodeId);
    setError(undefined);
    try {
      const response = await callAgent<AdaptiveExplanation>({
        action: "explain",
        node: explanationNodeContext(node),
        level,
        learnerProfile: explanationLearnerProfile(syncedProfile(undefined, { includeGoal: mode === "brick" && brickIntent === "destination" })),
        documents: agentDocuments,
      });
      if (!response.data) throw new Error("No explanation returned.");
      const adapted = { ...response.data, level } satisfies AdaptiveExplanation;
      setExplanations((current) => ({ ...current, [node.id]: adapted }));
      setTrace((current) => [...current, ...(response.trace as AgentTraceEvent[])].slice(-100));
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setExplanationLoadingNodeId(undefined);
    }
  }

  const retryNodeResources = useCallback((nodeId: string) => {
    const node = nodes.find((item) => item.id === nodeId);
    if (!node) return;
    void hydrateResources(
      [node],
      syncedProfile(undefined, { includeGoal: mode === "brick" && brickIntent === "destination" }),
      activeWorkspaceId,
      true,
    );
  }, [nodes, hydrateResources, syncedProfile, mode, brickIntent, activeWorkspaceId]);

  useEffect(() => {
    if (!mapNodes.length) return;
    // Generation starts hydration immediately. This pass also covers imported or
    // older workspaces so every visible node gets one adaptive resource attempt.
    void hydrateResources(
      mapNodes,
      syncedProfile(undefined, { includeGoal: mode === "brick" && brickIntent === "destination" }),
    );
  }, [mapNodes, hydrateResources, syncedProfile, mode, brickIntent]);

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
          <section className={styles.setupSection}>
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
            resourceLoadingNodeIds={resourceLoadingNodeIds}
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
            onRetryResources={retryNodeResources}
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
