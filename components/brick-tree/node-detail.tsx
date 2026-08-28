"use client";

import type { ConceptNode } from "@/lib/schemas/concept";
import type { AdaptiveExplanation } from "@/lib/schemas/api";
import type { PrimaryMode } from "@/components/brick-tree/model";
import { levelLabel, statusText } from "@/components/brick-tree/model";
import { Buffer } from "@/components/brick-tree/shell";
import styles from "../BrickTreeApp.module.css";

export function KnowledgeNode({
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
  onRetryResources,
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
  onRetryResources: () => void;
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
          if (event.currentTarget.open) onExplain();
        }}
      >
        <summary>{explanationLoading ? "Loading detail…" : "Open detail"}</summary>
        <div className={styles.detailBody}>
          <section>
            <h3>Explanation</h3>
            <p>{explanation?.explanation || node.detailedExplanation || node.difficultyExplanation}</p>
            {explanation?.example ? <div className={styles.example}><strong>Example</strong><p>{explanation.example}</p></div> : null}
            {explanation?.keyTakeaway ? <div className={styles.takeaway}>{explanation.keyTakeaway}</div> : null}
          </section>

          {node.whyItMatters ? <section><h3>Why this node matters</h3><p>{node.whyItMatters}</p></section> : null}

          <section>
            <h3>Resources</h3>
            {node.resources.length ? (
              <div className={styles.resources}>
                {node.resources.map((resource) => (
                  <a key={resource.url} href={resource.url} target="_blank" rel="noreferrer">
                    <strong>{resource.title}</strong>
                    <span>{resource.source} · {resource.type}</span>
                  </a>
                ))}
              </div>
            ) : resourceLoading ? (
              <p>Loading adaptive resources for this node…</p>
            ) : (
              <div className={styles.resourceEmpty}>
                <p>No credible matching external resource was returned.</p>
                <button type="button" onClick={onRetryResources}>Retry resources</button>
              </div>
            )}
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

