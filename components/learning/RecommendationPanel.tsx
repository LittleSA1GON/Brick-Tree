"use client";

import type { LearningPathProposal } from "@/lib/schemas/learning-path";

export function RecommendationPanel({
  path,
  intent = "explore",
}: {
  path?: LearningPathProposal;
  intent?: "explore" | "destination";
}) {
  if (!path) return null;
  const recommended = path.directions.find((direction) => direction.title === path.recommendedTitle);
  return (
    <section className="recommendation-panel ui-enter-up">
      <div className="recommendation-icon">★</div>
      <div className="recommendation-content">
        <span className="eyebrow">Recommended next brick</span>
        <h2>{path.recommendedTitle}</h2>
        <p>{path.recommendationReason}</p>
        {recommended ? (
          <>
            <div className="score-row" aria-label="Recommendation signals">
              <span>Difficulty {recommended.difficulty}/5 · {recommended.difficultyLabel}</span>
              <span>Readiness {Math.round(recommended.readinessScore)}</span>
              {intent === "destination" ? <span>Goal fit {Math.round(recommended.goalAlignmentScore)}</span> : null}
              <span>Utility {Math.round(recommended.utilityScore)}</span>
            </div>
            <div className="recommendation-evidence">
              <div>
                <strong>Why this fits now</strong>
                {recommended.satisfiedPrerequisites.length ? (
                  <ul>{recommended.satisfiedPrerequisites.slice(0, 4).map((item) => <li key={item}>✓ {item}</li>)}</ul>
                ) : <span>No prerequisite evidence was explicitly listed.</span>}
              </div>
              <div>
                <strong>Still to strengthen</strong>
                {recommended.missingPrerequisites.length ? (
                  <ul>{recommended.missingPrerequisites.slice(0, 4).map((item) => <li key={item}>△ {item}</li>)}</ul>
                ) : <span>No major missing prerequisite was identified.</span>}
              </div>
              <div>
                <strong>What it unlocks</strong>
                {recommended.unlocks.length ? (
                  <ul>{recommended.unlocks.slice(0, 4).map((item) => <li key={item}>→ {item}</li>)}</ul>
                ) : <span>Explore this brick to reveal future branches.</span>}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
