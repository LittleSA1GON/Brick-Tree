export function normalizeConceptTitle(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function slugify(value: string): string {
  return normalizeConceptTitle(value).replace(/\s+/g, "-").slice(0, 72) || "concept";
}
