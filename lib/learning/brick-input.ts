const LEADING_KNOWLEDGE_PHRASES = [
  /^i\s+(?:already\s+)?(?:know|understand|learned|studied|use|can use|am familiar with|am comfortable with|have experience with|have worked with)\s+/i,
  /^i['’]?m\s+(?:already\s+)?(?:familiar with|comfortable with|good at|experienced with)\s+/i,
  /^my\s+(?:current\s+)?(?:knowledge|background|experience)\s+(?:is|includes|covers)\s+/i,
  /^(?:i\s+)?(?:know|understand|familiar with|comfortable with|experienced with)\s+/i,
];

const POSITIVE_KNOWLEDGE = /\b(?:i\s+(?:already\s+)?(?:know|understand|learned|studied|use|can use|am familiar with|am comfortable with|have experience with|have worked with)|i['’]?m\s+(?:already\s+)?(?:familiar with|comfortable with|good at|experienced with)|my\s+(?:current\s+)?(?:knowledge|background|experience)\s+(?:is|includes|covers))\b/i;
const NEGATED_KNOWLEDGE = /\b(?:i\s+)?(?:do\s+not|don['’]?t|dont|can['’]?t|cannot|have\s+not|haven['’]?t)\s+(?:know|understand|use|follow|remember|grasp|study|studied|learn|learned)\b/i;
const STARTING_FROM_SCRATCH = /\b(?:start(?:ing)?\s+from\s+scratch|complete(?:ly)?\s+(?:new|beginner)|brand\s+new|no\s+prior\s+(?:knowledge|experience)|know\s+nothing|don['’]?t\s+know\s+anything)\b/i;
const GOAL_ONLY = /\b(?:i\s+)?(?:want|hope|need|plan|would\s+like|trying)\s+to\s+(?:learn|understand|study|master|become|build)\b/i;
const CLAUSE_SPLIT = /[\n,;|•]+|\b(?:but|however|although|though|except)\b/gi;

function cleanSegment(value: string): string {
  let next = value
    .replace(/^[-*•\d.)\s]+/, "")
    .replace(/^(?:and|plus|also|as well as)\s+/i, "")
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  for (const pattern of LEADING_KNOWLEDGE_PHRASES) next = next.replace(pattern, "").trim();
  return next;
}

function splitLong(value: string, maxLength = 150): string[] {
  if (value.length <= maxLength) return [value];
  const words = value.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (`${current} ${word}`.length <= maxLength) {
      current += ` ${word}`;
    } else {
      chunks.push(current);
      current = word;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function safeConceptParts(value: string, allowConjunctionSplit: boolean): string[] {
  const cleaned = cleanSegment(value);
  if (!cleaned) return [];
  if (!allowConjunctionSplit) return splitLong(cleaned, 150);

  const parts = cleaned
    .split(/\s+(?:and|plus|as well as)\s+/i)
    .map(cleanSegment)
    .filter(Boolean);
  if (parts.length > 1 && parts.length <= 9 && parts.every((part) => part.length <= 150)) return parts;
  return splitLong(cleaned, 150);
}

/**
 * Turns arbitrary Brick foundation prose into schema-safe concept strings.
 * The full raw statement is still sent to the Learning Path Agent so it can
 * interpret nuance; this parser is the deterministic fallback and graph-safe
 * representation used before/when a model is unavailable.
 */
export function parseBrickKnowledgeInput(input: string): string[] {
  const raw = input.replace(/\r/g, "\n").trim();
  if (!raw) return [];

  const listLike = /[\n,;|•]/.test(raw);
  const clauses = raw.split(CLAUSE_SPLIT).map((value) => value.trim()).filter(Boolean);
  const parsed: string[] = [];

  for (const clause of clauses) {
    if (NEGATED_KNOWLEDGE.test(clause) || STARTING_FROM_SCRATCH.test(clause) || GOAL_ONLY.test(clause)) continue;

    const explicitKnowledge = POSITIVE_KNOWLEDGE.test(clause);
    const cleaned = cleanSegment(clause);
    if (!cleaned) continue;

    // A clause that still begins like unrelated first-person prose is too
    // ambiguous to mark as known unless the learner explicitly framed it as knowledge.
    if (!explicitKnowledge && /^i\b/i.test(cleaned) && !listLike) continue;

    parsed.push(...safeConceptParts(clause, explicitKnowledge || listLike));
  }

  // The field itself means "what do you already know?", so an otherwise plain
  // concept phrase such as "counting alphabet speech" is a valid foundation.
  // Do not apply this fallback to explicit unknown/scratch/goal statements.
  if (!parsed.length && !NEGATED_KNOWLEDGE.test(raw) && !STARTING_FROM_SCRATCH.test(raw) && !GOAL_ONLY.test(raw)) {
    parsed.push(...safeConceptParts(raw, false));
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of parsed) {
    const normalized = value.slice(0, 160).trim();
    if (!normalized) continue;
    const key = normalized.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(normalized);
    if (unique.length >= 60) break;
  }
  return unique;
}
