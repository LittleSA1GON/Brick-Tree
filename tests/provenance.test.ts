import { describe, expect, it } from "vitest";
import {
  evidenceCoverageFindings,
  verifiedEvidenceReferences,
} from "@/lib/documents/provenance";

const chunks = [
  {
    id: "paper-1:method",
    title: "Paper — Method",
    source: "paper.pdf",
    text: "The method uses attention.",
    score: 0.9,
    metadata: { documentId: "paper-1", sectionId: "method", page: 5, heading: "Method" },
  },
];

describe("source provenance", () => {
  it("keeps only evidence references that were actually retrieved", () => {
    const verified = verifiedEvidenceReferences([
      { documentId: "paper-1", sectionId: "method", page: 5 },
      { documentId: "paper-1", sectionId: "invented", page: 99 },
    ], chunks);
    expect(verified).toHaveLength(1);
    expect(verified[0].sectionId).toBe("method");
  });

  it("rejects fabricated references and missing evidence in uploaded-only mode", () => {
    const findings = evidenceCoverageFindings([
      { title: "Attention", evidence: [{ documentId: "paper-1", sectionId: "method" }] },
      { title: "Reinforcement Learning", evidence: [{ documentId: "paper-1", sectionId: "invented" }] },
      { title: "Optimization", evidence: [] },
    ], chunks, true);
    expect(findings.some((finding) => finding.type === "citation_mismatch")).toBe(true);
    expect(findings.filter((finding) => finding.type === "unsupported_by_source")).toHaveLength(2);
  });
});
