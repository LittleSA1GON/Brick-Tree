"use client";

import { useRef, useState } from "react";

export function SessionTransfer({
  hasSession,
  onDownload,
  onUpload,
}: {
  hasSession: boolean;
  onDownload: () => void;
  onUpload: (file: File) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();

  async function importFile(file: File) {
    setLoading(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await onUpload(file);
      setMessage(`Loaded ${file.name}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Session import failed.");
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className="session-transfer" aria-label="Continue a Brick Tree session">
      <div className="session-transfer-copy">
        <span className="eyebrow">Portable session</span>
        <strong>Continue without cloud storage</strong>
        <p>
          Brick Tree keeps the current graph only in memory. Download a session file before leaving,
          then upload it later to restore the graph, learner settings, explanations, and extracted source text.
        </p>
      </div>
      <div className="session-transfer-actions">
        <button type="button" className="ghost-button" disabled={!hasSession} onClick={onDownload}>
          Download session
        </button>
        <button type="button" className="ghost-button" disabled={loading} onClick={() => inputRef.current?.click()}>
          {loading ? "Loading…" : "Upload session"}
        </button>
        <input
          ref={inputRef}
          hidden
          type="file"
          accept=".json,.bricktree.json,application/json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importFile(file);
          }}
        />
      </div>
      <small>
        No account, database, Blob storage, browser persistence, or server-side workspace is used. The exported file can contain extracted text from uploaded learning sources, so treat it as private if your source material is private.
      </small>
      {message ? <p className="session-transfer-success">{message}</p> : null}
      {error ? <p className="source-error">{error}</p> : null}
    </section>
  );
}
