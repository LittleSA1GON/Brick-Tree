import type { ExtractedDocument, DocumentSection } from "@/lib/schemas/documents";

const MAX_TEXT = 90_000;
const SECTION_TARGET = 5_000;

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "document";
}

function chunkText(
  text: string,
  options: { page?: number; idPrefix?: string } = {},
): DocumentSection[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n{4,}/g, "\n\n").trim();
  if (!normalized) return [];
  const blocks = normalized.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  const sections: DocumentSection[] = [];
  let buffer = "";
  let heading: string | undefined;

  const flush = () => {
    if (!buffer.trim()) return;
    const index = sections.length + 1;
    sections.push({
      id: `${options.idPrefix ?? "section"}-${index}`,
      heading,
      text: buffer.trim().slice(0, 12_000),
      page: options.page,
    });
    buffer = "";
    heading = undefined;
  };

  for (const block of blocks) {
    const isHeading = block.length <= 120 && !/[.!?]$/.test(block) && block.split(/\s+/).length <= 14;
    if (isHeading && buffer.length > 500) {
      flush();
      heading = block.replace(/^#+\s*/, "");
      continue;
    }
    if (buffer && buffer.length + block.length > SECTION_TARGET) flush();
    buffer += `${buffer ? "\n\n" : ""}${block}`;
  }
  flush();
  if (!sections.length) {
    sections.push({
      id: `${options.idPrefix ?? "section"}-1`,
      text: normalized.slice(0, 12_000),
      page: options.page,
    });
  }
  return sections;
}

function inferMetadata(
  text: string,
  pageCount?: number,
  provided?: { author?: string },
): ExtractedDocument["metadata"] | undefined {
  const doiMatch = text.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i);
  const yearMatch = text.slice(0, 15_000).match(/\b(?:19|20)\d{2}\b/);
  const metadata: NonNullable<ExtractedDocument["metadata"]> = {};
  if (provided?.author?.trim()) metadata.authors = [provided.author.trim()].slice(0, 20);
  if (doiMatch) metadata.doi = doiMatch[0].replace(/[.,;)]$/, "");
  if (yearMatch) metadata.publicationDate = yearMatch[0];
  if (pageCount) metadata.pageCount = pageCount;
  return Object.keys(metadata).length ? metadata : undefined;
}

async function extractPdfPages(
  buffer: Buffer,
): Promise<{ text: string; pages: string[]; pageCount?: number; title?: string; author?: string }> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const textResult = await parser.getText();
    const infoResult = await parser.getInfo();
    const info = (infoResult as unknown as { info?: Record<string, unknown>; infoData?: Record<string, unknown> }).infoData
      ?? (infoResult as unknown as { info?: Record<string, unknown> }).info
      ?? {};
    const title = typeof info.Title === "string" ? info.Title.trim() : undefined;
    const author = typeof info.Author === "string" ? info.Author.trim() : undefined;
    return {
      text: textResult.text,
      pages: textResult.pages.map((page) => page.text.trim()).filter(Boolean),
      pageCount: textResult.total,
      title: title || undefined,
      author: author || undefined,
    };
  } finally {
    await parser.destroy();
  }
}

export async function parseLearningDocument(file: File): Promise<{ document: ExtractedDocument; warnings: string[] }> {
  const warnings: string[] = [];
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  const buffer = Buffer.from(await file.arrayBuffer());
  let text = "";
  let sections: DocumentSection[] = [];
  let pageCount: number | undefined;
  let documentTitle: string | undefined;
  let documentAuthor: string | undefined;

  if (["txt", "md", "markdown", "csv", "tsv", "json"].includes(extension) || file.type.startsWith("text/")) {
    text = buffer.toString("utf8");
  } else if (extension === "docx" || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
    if (result.messages.length) warnings.push("Some DOCX formatting could not be preserved; textual content was extracted.");
  } else if (extension === "pdf" || file.type === "application/pdf") {
    const result = await extractPdfPages(buffer);
    text = result.text;
    pageCount = result.pageCount;
    documentTitle = result.title;
    documentAuthor = result.author;
    if (result.pages.length) {
      sections = result.pages.flatMap((pageText, index) =>
        chunkText(pageText, { page: index + 1, idPrefix: `page-${index + 1}` }),
      );
    } else {
      warnings.push("PDF text was extracted, but page-level provenance could not be recovered by this parser.");
    }
  } else {
    throw new Error("Unsupported file type. Use PDF, DOCX, TXT, Markdown, CSV, TSV, or JSON.");
  }

  if (!text.trim()) throw new Error("No readable text could be extracted from this file.");
  if (text.length > MAX_TEXT) warnings.push("The document was truncated to the first 90,000 characters for the interactive workspace.");
  const boundedText = text.slice(0, MAX_TEXT);

  if (!sections.length) sections = chunkText(boundedText);
  // Keep the same global text budget even for page-aware PDF parsing.
  let accumulated = 0;
  sections = sections.filter((section) => {
    if (accumulated >= MAX_TEXT) return false;
    accumulated += section.text.length;
    return true;
  }).slice(0, 40);

  const title = documentTitle || file.name.replace(/\.[^.]+$/, "") || "Uploaded document";
  const stamp = Date.now().toString(36);
  return {
    document: {
      id: `${safeId(title)}-${stamp}`,
      title,
      fileName: file.name,
      mimeType: file.type || undefined,
      sections,
      metadata: inferMetadata(boundedText, pageCount, { author: documentAuthor }),
    },
    warnings,
  };
}
