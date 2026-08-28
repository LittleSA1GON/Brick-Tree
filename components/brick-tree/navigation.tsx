"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { ConceptEdge, ConceptNode } from "@/lib/schemas/concept";
import type { LearningPathProposal } from "@/lib/schemas/learning-path";
import type { PrimaryMode, WorkspaceSnapshot } from "@/components/brick-tree/model";
import { MiniGraphMap } from "@/components/brick-tree/MiniGraphMap";
import styles from "../BrickTreeApp.module.css";

export function NavigatorDrawer({
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

export function PersistentMiniMap({
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
  const mapRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>();

  const clampPosition = useCallback((left: number, top: number) => {
    const map = mapRef.current;
    const width = map?.offsetWidth ?? 250;
    const height = map?.offsetHeight ?? 168;
    const margin = 8;
    return {
      left: Math.max(margin, Math.min(left, Math.max(margin, window.innerWidth - width - margin))),
      top: Math.max(margin, Math.min(top, Math.max(margin, window.innerHeight - height - margin))),
    };
  }, []);

  function startMapDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const map = mapRef.current;
    if (!map) return;
    const rect = map.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    setPosition(clampPosition(rect.left, rect.top));
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveMap(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPosition(clampPosition(event.clientX - drag.offsetX, event.clientY - drag.offsetY));
    event.preventDefault();
  }

  function endMapDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  useEffect(() => {
    const onResize = () => setPosition((current) => current ? clampPosition(current.left, current.top) : current);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampPosition]);

  return (
    <aside
      ref={mapRef}
      className={styles.persistentMap}
      aria-label={`${mode === "tree" ? "Tree" : "Brick"} mini map`}
      style={position ? { left: position.left, top: position.top, right: "auto", bottom: "auto" } : undefined}
    >
      <span className={styles.persistentMapTitle}>{mode === "tree" ? "Tree" : "Brick"} map</span>
      <button
        type="button"
        className={styles.persistentMapDragHandle}
        aria-label="Move mini map"
        title="Drag to move mini map"
        onPointerDown={startMapDrag}
        onPointerMove={moveMap}
        onPointerUp={endMapDrag}
        onPointerCancel={endMapDrag}
      >
        <span aria-hidden="true">⠿</span>
      </button>
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

