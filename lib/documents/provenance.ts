import type { EvidenceReference } from "@/lib/schemas/concept";
import type { RetrievedChunk } from "@/lib/schemas/documents";

export function evidenceReferenceKey(ref: Pick<EvidenceReference, "documentId" | "sectionId">): string {
  return `${ref.documentId}:${ref.sectionId}`;
}

export function chunkEvidenceReference(chunk: RetrievedChunk): EvidenceReference | undefined {
  const metadata = chunk.metadata ?? {};
  const documentId = typeof metadata.documentId === "string" ? metadata.documentId : undefined;
  const sectionId = typeof metadata.sectionId === "string" ? metadata.sectionId : undefined;
  if (!documentId || !sectionId) return undefined;
  return {
    documentId,
    sectionId,
    page: typeof metadata.page === "number" ? metadata.page : undefined,
    heading: typeof metadata.heading === "string" ? metadata.heading : undefined,
  };
}

export function retrievedEvidenceKeys(chunks: RetrievedChunk[]): Set<string> {
  return new Set(
    chunks
      .map(chunkEvidenceReference)
      .filter((ref): ref is EvidenceReference => Boolean(ref))
      .map(evidenceReferenceKey),
  );
}

export function verifiedEvidenceReferences(
  refs: EvidenceReference[],
  chunks: RetrievedChunk[],
): EvidenceReference[] {
  if (!refs.length || !chunks.length) return [];
  const allowed = retrievedEvidenceKeys(chunks);
  return refs.filter((ref) => allowed.has(evidenceReferenceKey(ref)));
}

export function evidenceCoverageFindings(
  groups: Array<{ title: string; evidence: EvidenceReference[] }>,
  chunks: RetrievedChunk[],
  requireEach: boolean,
): Array<{
  type: "citation_mismatch" | "unsupported_by_source";
  title: string;
  message: string;
}> {
  const allowed = retrievedEvidenceKeys(chunks);
  const findings: Array<{
    type: "citation_mismatch" | "unsupported_by_source";
    title: string;
    message: string;
  }> = [];

  for (const group of groups) {
    const invalid = group.evidence.filter((ref) => !allowed.has(evidenceReferenceKey(ref)));
    if (invalid.length) {
      findings.push({
        type: "citation_mismatch",
        title: group.title,
        message: `${group.title} cites ${invalid.length} evidence reference${invalid.length === 1 ? "" : "s"} that were not present in retrieved source evidence.`,
      });
    }
    if (requireEach) {
      const validCount = group.evidence.filter((ref) => allowed.has(evidenceReferenceKey(ref))).length;
      if (!validCount) {
        findings.push({
          type: "unsupported_by_source",
          title: group.title,
          message: `${group.title} has no verified uploaded-source evidence in Uploaded Only mode.`,
        });
      }
    }
  }

  return findings;
}
