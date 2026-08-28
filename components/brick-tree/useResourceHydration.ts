"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ConceptNode } from "@/lib/schemas/concept";
import type { LearnerProfile } from "@/lib/schemas/learning-path";
import type { AgentTraceEvent } from "@/lib/observability/trace";
import { callAgent } from "@/lib/utils/api-client";
import {
  resourceLearnerProfile,
  resourceNodeContext,
  resourceProfileFingerprint,
  type ResourceBatchData,
} from "@/components/brick-tree/model";

type Options = {
  activeWorkspaceId?: string;
  setNodes: Dispatch<SetStateAction<ConceptNode[]>>;
  setTrace: Dispatch<SetStateAction<AgentTraceEvent[]>>;
  setWarnings: Dispatch<SetStateAction<string[]>>;
};

export function useResourceHydration({ activeWorkspaceId, setNodes, setTrace, setWarnings }: Options) {
  const [loadingNodeIds, setLoadingNodeIds] = useState<Set<string>>(new Set());
  const attemptedRef = useRef<Set<string>>(new Set());
  const contextRef = useRef<Map<string, string>>(new Map());
  const workspaceRef = useRef(activeWorkspaceId);

  useEffect(() => {
    workspaceRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);

  const hydrate = useCallback(async (
    candidateNodes: ConceptNode[],
    learner: LearnerProfile,
    workspaceId = activeWorkspaceId,
    force = false,
  ) => {
    const workspaceKey = workspaceId ?? "workspace";
    const profileKey = resourceProfileFingerprint(learner);
    const pending = candidateNodes.filter((node) => {
      if (!node.parentId && node.title === "Your Foundations") return false;
      if (force) return true;

      const nodeKey = `${workspaceKey}:${node.id}`;
      const hydratedContext = contextRef.current.get(nodeKey);
      if (node.resources.length && !hydratedContext) {
        contextRef.current.set(nodeKey, profileKey);
        return false;
      }
      if (node.resources.length && hydratedContext === profileKey) return false;
      return !attemptedRef.current.has(`${nodeKey}:${profileKey}`);
    }).slice(0, 20);

    if (!pending.length) return;

    for (const node of pending) attemptedRef.current.add(`${workspaceKey}:${node.id}:${profileKey}`);
    const pendingIds = new Set(pending.map((node) => node.id));
    setLoadingNodeIds((current) => new Set([...current, ...pendingIds]));

    try {
      const response = await callAgent<ResourceBatchData>({
        action: "resources",
        nodes: pending.map(resourceNodeContext),
        learnerProfile: resourceLearnerProfile(learner),
      });
      if (!response.data) throw new Error("No resources returned.");
      if ((workspaceRef.current ?? "workspace") !== workspaceKey) return;

      const byId = new Map(response.data.items.map((item) => [item.nodeId, item.resources]));
      for (const node of pending) {
        if (byId.has(node.id)) contextRef.current.set(`${workspaceKey}:${node.id}`, profileKey);
      }
      setNodes((current) => current.map((node) => byId.has(node.id) ? { ...node, resources: byId.get(node.id)! } : node));
      setTrace((current) => [...current, ...(response.trace as AgentTraceEvent[])].slice(-100));
      if (response.warnings.length) {
        setWarnings((current) => [...new Set([...current, ...response.warnings])].slice(0, 10));
      }
    } catch (error) {
      if ((workspaceRef.current ?? "workspace") === workspaceKey) {
        const message = error instanceof Error ? error.message : String(error);
        setWarnings((current) => [...new Set([...current, `Resource loading can be retried: ${message}`])].slice(0, 10));
      }
    } finally {
      setLoadingNodeIds((current) => {
        const next = new Set(current);
        for (const id of pendingIds) next.delete(id);
        return next;
      });
    }
  }, [activeWorkspaceId, setNodes, setTrace, setWarnings]);

  return { hydrateResources: hydrate, resourceLoadingNodeIds: loadingNodeIds };
}
