"use client";

import { useEffect, useRef, useState } from "react";
import type { GraphLevelDescriptor } from "@/lib/schemas/concept";
import type { PrimaryMode } from "@/components/brick-tree/model";
import styles from "../BrickTreeApp.module.css";

export function Landing({ onBegin }: { onBegin: (mode: PrimaryMode) => void }) {
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

export function BrandIcon() {
  return <span className={styles.brandIcon} aria-hidden="true"><i /><i /><i /><b /></span>;
}

export function ModeDock({ mode, onChange }: { mode: PrimaryMode; onChange: (mode: PrimaryMode) => void }) {
  return (
    <div className={styles.modeDock} aria-label="Switch between Tree and Brick">
      <button type="button" className={mode === "tree" ? styles.modeActive : ""} onClick={() => onChange("tree")}>Tree</button>
      <button type="button" className={mode === "brick" ? styles.modeActive : ""} onClick={() => onChange("brick")}>Brick</button>
    </div>
  );
}


export function ZoomControls({ value, onDecrease, onIncrease, onReset }: {
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

export function AxisRail({ axis, levels, activeLevel, descriptors, dismissKey, onSelect }: {
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

export function Buffer({ label }: { label?: string }) {
  return (
    <div className={styles.buffer} role="status" aria-live="polite">
      <div className={styles.bufferTrack}><i /><i /><i /><i /></div>
      <span>{label || "Agents are preparing the next layer…"}</span>
    </div>
  );
}

