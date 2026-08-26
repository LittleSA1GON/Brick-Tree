import type { ExtractedDocument } from "@/lib/schemas/documents";
import type { RetrievedChunk } from "@/lib/schemas/documents";

function terms(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function asChunk(
  document: ExtractedDocument,
  section: ExtractedDocument["sections"][number],
  score: number,
  retrievalFallback = false,
): RetrievedChunk {
  return {
    id: `${document.id}:${section.id}`,
    title: section.heading ? `${document.title} — ${section.heading}` : document.title,
    source: document.fileName,
    text: section.text,
    score,
    metadata: {
      documentId: document.id,
      sectionId: section.id,
      page: section.page,
      heading: section.heading,
      retrievalFallback,
    },
  };
}


const STRUCTURE_QUERY = /\b(?:major|concepts?|components?|structure|outline|map|sections?)\b/i;
const REPRESENTATIVE_HEADING = /\b(?:abstract|introduction|background|related work|method|methodology|approach|experiment|results?|discussion|conclusion|implications?|limitations?)\b/i;

function representativeDocumentChunks(
  documents: ExtractedDocument[],
  limit: number,
): RetrievedChunk[] {
  const chosen: RetrievedChunk[] = [];
  for (const document of documents) {
    const preferred = document.sections.filter((section) => REPRESENTATIVE_HEADING.test(section.heading ?? ""));
    const ordered = [...preferred, ...document.sections].filter(
      (section, index, all) => all.findIndex((candidate) => candidate.id === section.id) === index,
    );
    for (const section of ordered) {
      chosen.push(asChunk(document, section, 0.2, true));
      if (chosen.length >= limit) return chosen;
    }
  }
  return chosen;
}

/**
 * Lightweight local retrieval for anonymous/Vercel-safe document sessions.
 * It is deterministic; optional HTTP RAG remains a separate agent tool.
 */
export function searchExtractedDocuments(
  documents: ExtractedDocument[],
  query: string,
  topK = 5,
): RetrievedChunk[] {
  const queryTerms = [...new Set(terms(query))];
  if (!queryTerms.length || !documents.length) return [];

  const scored: RetrievedChunk[] = [];
  for (const document of documents) {
    const documentIdentity = `${document.title} ${document.fileName}`.toLowerCase();
    for (const section of document.sections) {
      const heading = section.heading ?? "";
      const haystack = `${documentIdentity} ${heading} ${section.text}`.toLowerCase();
      let matches = 0;
      for (const term of queryTerms) {
        if (haystack.includes(term)) matches += 1;
      }
      if (!matches) continue;
      const headingBonus = heading
        ? queryTerms.filter((term) => heading.toLowerCase().includes(term)).length * 0.25
        : 0;
      const titleBonus = queryTerms.filter((term) => documentIdentity.includes(term)).length * 0.12;
      const score = Math.min(1, matches / queryTerms.length + headingBonus + titleBonus);
      scored.push(asChunk(document, section, score));
    }
  }

  const limit = Math.max(1, Math.min(topK, 10));
  const ranked = scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, limit);

  // Mapping/decomposition requests benefit from coverage across a paper's
  // representative sections instead of several nearly identical title hits.
  // These are still real source sections with explicit provenance.
  if (STRUCTURE_QUERY.test(query)) {
    const representative = representativeDocumentChunks(documents, limit);
    if (representative.length) return representative;
  }

  if (ranked.length) return ranked;

  // A broad request such as "map this paper" may not share literal terms with
  // the paper body. Return a bounded beginning-of-document sample instead of
  // failing source-grounded mode outright. The fallback is labeled in metadata
  // so agents/validators can treat it as broad context rather than a strong hit.
  return documents
    .flatMap((document) => document.sections.slice(0, 2).map((section) => asChunk(document, section, 0.05, true)))
    .slice(0, limit);
}
