import type { LearnerProfile, LearningDirectionProposal } from "@/lib/schemas/learning-path";

export type LearnerFitIssue = {
  title: string;
  message: string;
};

const KNOWLEDGE_CEILING = {
  novice: 2,
  beginner: 2,
  intermediate: 3,
  advanced: 4,
  expert: 5,
} as const;

const EDUCATION_CEILING: Record<string, number> = {
  elementary: 2,
  "elementary-school": 2,
  "middle-school": 2,
  "high-school": 3,
  highschool: 3,
  college: 4,
  university: 4,
  graduate: 5,
  professional: 5,
};

export function learnerDifficultyCeiling(profile?: LearnerProfile): number {
  const education = profile?.educationLevel?.trim().toLowerCase();
  const byEducation = education ? EDUCATION_CEILING[education] : undefined;
  const byKnowledge = profile?.knowledgeLevel ? KNOWLEDGE_CEILING[profile.knowledgeLevel] : undefined;

  if (byEducation !== undefined && byKnowledge !== undefined) return Math.min(5, Math.max(1, Math.max(byEducation, byKnowledge)));
  return byEducation ?? byKnowledge ?? 3;
}

export function learnerFitSummary(profile?: LearnerProfile): string {
  const education = profile?.educationLevel || "not specified";
  const knowledge = profile?.knowledgeLevel || "not specified";
  const bias = profile?.exploreBias || "balanced";
  const ceiling = learnerDifficultyCeiling(profile);
  return `Education level: ${education}. Knowledge level: ${knowledge}. Explore bias: ${bias}. In Explore mode, ordinary next-step suggestions should stay at or below difficulty ${ceiling}/5 unless the learner explicitly supplied advanced prerequisite knowledge.`;
}

export function learnerFitIssues(
  profile: LearnerProfile | undefined,
  directions: Array<Pick<LearningDirectionProposal, "title" | "difficulty" | "missingPrerequisites">>,
  intent: "explore" | "destination",
): LearnerFitIssue[] {
  if (intent !== "explore") return [];
  const ceiling = learnerDifficultyCeiling(profile);
  return directions.flatMap((direction) => {
    const issues: LearnerFitIssue[] = [];
    if (direction.difficulty > ceiling) {
      issues.push({
        title: direction.title,
        message: `${direction.title} is difficulty ${direction.difficulty}/5, above the learner-fit ceiling ${ceiling}/5 for this Explore profile. Suggest a closer prerequisite or a more accessible application first.`,
      });
    }
    if (direction.missingPrerequisites.length >= 3) {
      issues.push({
        title: direction.title,
        message: `${direction.title} still lists ${direction.missingPrerequisites.length} missing prerequisites, so it is not a reasonable one-layer Explore step.`,
      });
    }
    return issues;
  });
}
