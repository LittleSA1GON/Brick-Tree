"use client";

import { useRef, useState } from "react";
import type { ExtractedDocument } from "@/lib/schemas/documents";

export function DocumentSources({
  documents,
  activeDocumentIds,
  sourceMode,
  onAdd,
  onRemove,
  onToggleActive,
  onUseAsTopic,
}: {
  documents: ExtractedDocument[];
  activeDocumentIds: Set<string>;
  sourceMode: "general" | "prefer-uploaded" | "uploaded-only";
  onAdd: (document: ExtractedDocument) => void;
  onRemove: (id: string) => void;
  onToggleActive: (id: string) => void;
  onUseAsTopic?: (document: ExtractedDocument) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();
  const [warning, setWarning] = useState<string>();

  async function upload(file: File) {
    setUploading(true);
    setError(undefined);
    setWarning(undefined);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/documents", { method: "POST", body: form });
      const payload = (await response.json()) as { ok: boolean; document?: ExtractedDocument; error?: string; warnings?: string[] };
      if (!payload.ok || !payload.document) throw new Error(payload.error || "Document upload failed.");
      onAdd(payload.document);
      if (payload.warnings?.length) setWarning(payload.warnings.join(" "));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Document upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className="source-uploader">
      <div className="section-heading-row compact">
        <div>
          <span className="eyebrow">Learning sources</span>
          <strong>Ground the graph in your material</strong>
        </div>
        <button type="button" className="ghost-button" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? "Extracting…" : "Upload source"}
        </button>
        <input
          ref={inputRef}
          hidden
          type="file"
          accept=".pdf,.docx,.txt,.md,.markdown,.csv,.tsv,.json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </div>
      {documents.length ? (
        <>
          <div className="source-list">
            {documents.map((document) => (
              <div className="source-chip" key={document.id}>
                <span aria-hidden="true">📄</span>
                <div>
                  <strong>{document.title}</strong>
                  <small>
                    {document.metadata?.authors?.length ? `${document.metadata.authors.join(", ")} · ` : ""}
                    {document.sections.length} extracted sections
                    {document.metadata?.pageCount ? ` · ${document.metadata.pageCount} pages` : ""}
                    {document.metadata?.doi ? ` · DOI ${document.metadata.doi}` : ""}
                  </small>
                </div>
                <button
                  type="button"
                  className={`source-use-button ${activeDocumentIds.has(document.id) ? "active" : ""}`}
                  aria-pressed={activeDocumentIds.has(document.id)}
                  onClick={() => onToggleActive(document.id)}
                >
                  {activeDocumentIds.has(document.id) ? "Using" : "Use"}
                </button>
                {onUseAsTopic ? <button type="button" className="source-map-button" onClick={() => onUseAsTopic(document)}>Map source</button> : null}
                <button type="button" className="source-remove-button" aria-label={`Remove ${document.title}`} onClick={() => onRemove(document.id)}>×</button>
              </div>
            ))}
          </div>
          <p className="source-selection-note">
            {sourceMode === "general"
              ? `${activeDocumentIds.size} source${activeDocumentIds.size === 1 ? "" : "s"} selected · General mode does not use uploads for grounding.`
              : `${activeDocumentIds.size} of ${documents.length} uploaded source${documents.length === 1 ? "" : "s"} active for grounding.`}
          </p>
          {sourceMode !== "general" && activeDocumentIds.size === 0 ? (
            <p className="source-warning">Select at least one uploaded source to use {sourceMode === "uploaded-only" ? "Uploaded Only" : "Prefer Uploaded"} grounding.</p>
          ) : null}
        </>
      ) : (
        <p className="muted">
          Optional: PDF, DOCX, TXT, Markdown, CSV, TSV, or JSON. Files are parsed for this live session only; Brick Tree does not persist them on Vercel.
        </p>
      )}
      {warning ? <p className="source-warning">{warning}</p> : null}
      {error ? <p className="source-error">{error}</p> : null}
    </section>
  );
}
