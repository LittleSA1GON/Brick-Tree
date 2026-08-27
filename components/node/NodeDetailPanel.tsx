"use client";

import { useEffect, useState } from "react";
import type { ConceptEdge, ConceptNode } from "@/lib/schemas/concept";
import type { ExplanationLevel } from "@/lib/schemas/api";

export type RelatedConcept = { id: string; title: string; relationshipType: ConceptEdge["relationshipType"] };

export type AdaptiveExplanation = {
  explanation: string;
  sourceSummary?: string;
  example: string;
  keyTakeaway: string;
  level?: ExplanationLevel;
  prerequisites?: string[];
  whatItUnlocks?: string[];
  evidence?: Array<{ documentId: string; sectionId: string; page?: number; heading?: string }>;
};

function statusLabel(status: ConceptNode["knowledgeStatus"]): string {
  switch (status) {
    case "known": return "Known brick";
    case "recommended": return "Recommended brick";
    case "future": return "Future brick";
    case "missing-prerequisite": return "Missing foundation";
    default: return "Available brick";
  }
}

export function NodeDetailPanel({
  node,
  explanation,
  resourceLoading,
  explanationLoading,
  onFindResources,
  onExplain,
  onBreakDown,
  onTraceRoots,
  onBuildFromHere,
  onMarkKnown,
  relatedConcepts,
  onSelectRelated,
  preferredExplanationLevel,
}: {
  node?: ConceptNode;
  explanation?: AdaptiveExplanation;
  resourceLoading: boolean;
  explanationLoading: boolean;
  onFindResources: () => void;
  onExplain: (level: ExplanationLevel) => void;
  onBreakDown: () => void;
  onTraceRoots: () => void;
  onBuildFromHere: () => void;
  onMarkKnown: () => void;
  relatedConcepts: RelatedConcept[];
  onSelectRelated: (id: string) => void;
  preferredExplanationLevel: ExplanationLevel;
}) {
  const [selectedExplanationLevel, setSelectedExplanationLevel] = useState<ExplanationLevel>(preferredExplanationLevel);

  useEffect(() => {
    setSelectedExplanationLevel(preferredExplanationLevel);
  }, [preferredExplanationLevel, node?.id]);

  return (
    <aside className="node-panel">
        {node ? (
          <div key={node.id} className="node-panel-content ui-enter-right">
            <div className="node-panel-header">
              <div>
                <span className="eyebrow">Selected brick</span>
                <h2>{node.title}</h2>
              </div>
              <div className="node-status-stack">
                <span className={`knowledge-chip knowledge-${node.knowledgeStatus}`}>{statusLabel(node.knowledgeStatus)}</span>
                <span className={`status-chip status-${node.status}`}>{node.status.replace("-", " ")}</span>
              </div>
            </div>

            <p className="node-summary">{node.shortDescription}</p>

            {explanation ? (
              <section className="brick-explanation-card">
                <span className="eyebrow">Brick Tree explanation</span>
                <p>{explanation.explanation}</p>
                <strong>{explanation.keyTakeaway}</strong>
              </section>
            ) : node.detailedExplanation ? (
              <section className="brick-explanation-card">
                <span className="eyebrow">Brick Tree explanation</span>
                <p>{node.detailedExplanation}</p>
              </section>
            ) : null}

            {explanation?.sourceSummary ? (
              <section className="source-grounding-card">
                <span className="eyebrow">What your source says</span>
                <p>{explanation.sourceSummary}</p>
                {explanation.evidence?.length ? (
                  <div className="evidence-inline">
                    {explanation.evidence.map((ref) => (
                      <span key={`${ref.documentId}:${ref.sectionId}`}>
                        {ref.heading || ref.sectionId}{ref.page ? ` · p. ${ref.page}` : ""}
                      </span>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className={`difficulty-card difficulty-${node.difficulty}`}>
              <div className="difficulty-card-heading">
                <div>
                  <span className="eyebrow">Understanding difficulty</span>
                  <h3>{node.difficulty}/5 · {node.difficultyLabel}</h3>
                </div>
                <span className={`difficulty-orb d${node.difficulty}`}>{node.difficulty}</span>
              </div>
              <p>{node.difficultyExplanation}</p>
              {node.difficultyFactors.length ? (
                <div className="factor-list">
                  {node.difficultyFactors.map((factor) => <span key={factor}>{factor}</span>)}
                </div>
              ) : null}
              <div className="difficulty-layer-note">
                <strong>This graph layer</strong>
                <span>{node.level.description}</span>
                <small>{node.level.peerRule}</small>
              </div>
            </section>

            {node.whyItMatters ? (
              <section>
                <h3>Why it matters</h3>
                <p>{node.whyItMatters}</p>
              </section>
            ) : null}

            {node.estimatedLearningTime ? (
              <section className="effort-card">
                <span className="eyebrow">Approximate learning effort</span>
                <strong>{node.estimatedLearningTime}</strong>
                <small>Rough guidance only; actual time varies with prior knowledge and practice.</small>
              </section>
            ) : null}

            <div className="detail-two-col">
              <section>
                <h3>Roots / prerequisites</h3>
                {(explanation?.prerequisites?.length ? explanation.prerequisites : node.prerequisites).length ? (
                  <ul>{(explanation?.prerequisites?.length ? explanation.prerequisites : node.prerequisites).slice(0, 7).map((item) => <li key={item}>{item}</li>)}</ul>
                ) : (
                  <p className="muted">No additional prerequisite was identified for this node at the selected learner level.</p>
                )}
              </section>
              <section>
                <h3>What it unlocks</h3>
                {(explanation?.whatItUnlocks?.length ? explanation.whatItUnlocks : node.whatItUnlocks)?.length ? (
                  <ul>{(explanation?.whatItUnlocks?.length ? explanation.whatItUnlocks : node.whatItUnlocks ?? []).slice(0, 7).map((item) => <li key={item}>{item}</li>)}</ul>
                ) : (
                  <p className="muted">No additional next-step concept was identified yet for this node.</p>
                )}
              </section>
            </div>

            {explanation?.example ? (
              <section className="example-card">
                <h3>Example</h3>
                <p>{explanation.example}</p>
                <strong>{explanation.keyTakeaway}</strong>
              </section>
            ) : node.examples.length ? (
              <section>
                <h3>Examples</h3>
                <ul>{node.examples.slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul>
              </section>
            ) : null}

            {node.applications.length ? (
              <section>
                <h3>Applications</h3>
                <div className="factor-list">{node.applications.slice(0, 8).map((item) => <span key={item}>{item}</span>)}</div>
              </section>
            ) : null}

            {node.learningOutcomes.length ? (
              <section>
                <h3>After learning this</h3>
                <ul>{node.learningOutcomes.slice(0, 7).map((item) => <li key={item}>{item}</li>)}</ul>
              </section>
            ) : null}

            {relatedConcepts.length ? (
              <section>
                <h3>Related concepts in this graph</h3>
                <div className="related-concepts">
                  {relatedConcepts.slice(0, 8).map((related) => (
                    <button type="button" key={`${related.id}:${related.relationshipType}`} onClick={() => onSelectRelated(related.id)}>
                      <strong>{related.title}</strong><span>{related.relationshipType.replace("-", " ")}</span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            <section>
              <h3>Knowledge origin</h3>
              <div className="origin-list">
                {node.origins.map((origin, index) => {
                  if (origin.type === "model-knowledge") return <span key={`model-${index}`}>AI-generated educational structure</span>;
                  if (origin.type === "external-resource") return <span key={origin.url}>External resource · {origin.url}</span>;
                  return (
                    <div key={`${origin.documentId}-${index}`} className="origin-source">
                      <strong>Uploaded source</strong>
                      {origin.evidence.map((ref) => (
                        <span key={`${ref.documentId}:${ref.sectionId}`}>
                          {ref.heading || ref.sectionId}{ref.page ? ` · page ${ref.page}` : ""}
                        </span>
                      ))}
                    </div>
                  );
                })}
              </div>
            </section>

            <section>
              <div className="section-heading-row compact">
                <h3>Resources</h3>
                <button type="button" className="text-button" onClick={onFindResources} disabled={resourceLoading}>
                  {resourceLoading ? "Searching…" : "Find resources"}
                </button>
              </div>
              {node.resources.length ? (
                <div className="resource-list">
                  {node.resources.map((resource) => (
                    <a key={resource.url} href={resource.url} target="_blank" rel="noopener noreferrer" className="resource-card">
                      <div>
                        <strong>{resource.title}</strong>
                        <span>{resource.source} · {resource.type}</span>
                      </div>
                      <span aria-hidden="true">↗</span>
                    </a>
                  ))}
                </div>
              ) : (
                <p className="muted">No external resources loaded. Brick Tree never asks the model to invent URLs.</p>
              )}
            </section>

            <section>
              <h3>Actions</h3>
              <div className="panel-actions panel-actions-grid">
                <button type="button" className="primary-action" onClick={onBreakDown}>Break this down</button>
                <button type="button" onClick={onTraceRoots}>Trace its roots</button>
                <button type="button" onClick={onBuildFromHere}>Build from here</button>
                <button type="button" onClick={onMarkKnown} disabled={node.knowledgeStatus === "known"}>
                  {node.knowledgeStatus === "known" ? "Marked as known" : "I understand this"}
                </button>
                <select
                  aria-label="Explanation level"
                  value={selectedExplanationLevel}
                  disabled={explanationLoading}
                  onChange={(event) => {
                    const next = event.target.value as ExplanationLevel;
                    setSelectedExplanationLevel(next);
                    onExplain(next);
                  }}
                >
                  <option value="simple">Explain: Simple</option>
                  <option value="beginner">Explain: Beginner</option>
                  <option value="intermediate">Explain: Intermediate</option>
                  <option value="advanced">Explain: Advanced</option>
                  <option value="expert">Explain: Expert</option>
                </select>
              </div>
              {explanationLoading ? <p className="muted">Adapting explanation…</p> : null}
            </section>
          </div>
        ) : (
          <div key="empty" className="node-panel-empty ui-enter">
            <div className="empty-orbit" aria-hidden="true"><span /></div>
            <h2>Select a brick</h2>
            <p>The node answers “What is this?” immediately. Selecting it opens why it matters, why it is difficult, its roots, what it unlocks, examples, and provenance.</p>
          </div>
        )}
    </aside>
  );
}
