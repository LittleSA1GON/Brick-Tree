"use client";

import type { FormEvent } from "react";
import type { ExtractedDocument } from "@/lib/schemas/documents";
import type { LearnerProfile as LearnerProfileType } from "@/lib/schemas/learning-path";
import type { BrickIntent, TreeIntent } from "@/lib/schemas/session";
import { LearnerProfile } from "@/components/learning/LearnerProfile";
import { DocumentSources } from "@/components/learning/DocumentSources";
import { SessionTransfer } from "@/components/session/SessionTransfer";
import type { PrimaryMode } from "@/components/brick-tree/model";
import { TREE_INTENT_COPY, modeAxis } from "@/components/brick-tree/model";
import { Buffer } from "@/components/brick-tree/shell";
import styles from "../BrickTreeApp.module.css";

export function SetupNode({
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

