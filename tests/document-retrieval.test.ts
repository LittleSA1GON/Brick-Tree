import { describe, expect, it } from "vitest";
import { searchExtractedDocuments } from "@/lib/documents/retrieval";
import { parseLearningDocument } from "@/lib/documents/parser";

const document = {
  id: "paper-1",
  title: "Attention Paper",
  fileName: "attention.txt",
  sections: [
    { id: "intro", heading: "Introduction", text: "Transformers use attention to relate tokens across a sequence." },
    { id: "method", heading: "Method", text: "The method computes queries, keys, and values using learned projections." },
  ],
};

describe("uploaded document pipeline", () => {
  it("retrieves relevant sections with provenance metadata", () => {
    const results = searchExtractedDocuments([document], "queries keys values", 3);
    expect(results[0].metadata?.documentId).toBe("paper-1");
    expect(results[0].metadata?.sectionId).toBe("method");
  });


  it("falls back to bounded source context for broad document-mapping queries", () => {
    const results = searchExtractedDocuments([document], "completely broad mapping request", 2);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].metadata?.retrievalFallback).toBe(true);
  });

  it("extracts and chunks a text learning source without external parsers", async () => {
    const file = new File(["Introduction\n\nGradient descent reduces an objective.\n\nMethod\n\nUpdates follow the negative gradient."], "notes.txt", { type: "text/plain" });
    const result = await parseLearningDocument(file);
    expect(result.document.title).toBe("notes");
    expect(result.document.sections.length).toBeGreaterThan(0);
    expect(result.document.sections.map((section) => section.text).join(" ")).toContain("Gradient descent");
  });

  it("extracts lightweight scholarly metadata when present in text sources", async () => {
    const file = new File(["A Paper\n\n2024\n\nDOI: 10.1234/example.5678\n\nMethod\n\nA useful method."], "paper.txt", { type: "text/plain" });
    const result = await parseLearningDocument(file);
    expect(result.document.metadata?.doi).toBe("10.1234/example.5678");
    expect(result.document.metadata?.publicationDate).toBe("2024");
  });

  it("samples representative paper sections for structure-mapping requests", () => {
    const paper = {
      ...document,
      sections: [
        { id: "intro", heading: "Introduction", text: "Background and motivation." },
        { id: "method", heading: "Methodology", text: "The proposed method uses attention." },
        { id: "results", heading: "Results", text: "Evaluation results improve accuracy." },
        { id: "conclusion", heading: "Conclusion", text: "The work summarizes implications." },
      ],
    };
    const results = searchExtractedDocuments([paper], "map the major concepts and structure", 4);
    expect(results.map((item) => item.metadata?.sectionId)).toEqual(["intro", "method", "results", "conclusion"]);
  });

});
