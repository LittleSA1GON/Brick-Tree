"use client";

import { useRef, useState } from "react";

export function SessionTransfer({
  hasSession,
  hasWorkspace,
  mode,
  onDownload,
  onDownloadWorkspace,
  onUpload,
  onUploadWorkspace,
}: {
  hasSession: boolean;
  hasWorkspace: boolean;
  mode: "tree" | "brick";
  onDownload: () => void;
  onDownloadWorkspace: () => void;
  onUpload: (file: File) => Promise<void>;
  onUploadWorkspace: (file: File) => Promise<void>;
}) {
  const sessionInputRef = useRef<HTMLInputElement | null>(null);
  const workspaceInputRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState<"session" | "workspace">();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();

  async function importFile(file: File, kind: "session" | "workspace") {
    setLoading(kind);
    setError(undefined);
    setMessage(undefined);
    try {
      if (kind === "session") await onUpload(file);
      else await onUploadWorkspace(file);
      setMessage(`Loaded ${file.name}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : `${kind === "session" ? "Session" : "Workspace"} import failed.`);
    } finally {
      setLoading(undefined);
      if (sessionInputRef.current) sessionInputRef.current.value = "";
      if (workspaceInputRef.current) workspaceInputRef.current.value = "";
    }
  }

  return (
    <section className="session-transfer" aria-label="Continue or move a Brick Tree workspace">
      <div className="session-transfer-copy">
        <span className="eyebrow">Portable files</span>
        <strong>Move a whole session or one {mode === "tree" ? "Tree" : "Brick"}</strong>
        <p>
          A session file carries every saved Tree and Brick plus learner settings and source text. A workspace file carries only one independent Tree or Brick map, so it can be shared or imported without replacing the rest of the session.
        </p>
      </div>
      <div className="session-transfer-actions">
        <button type="button" className="ghost-button" disabled={!hasWorkspace} onClick={onDownloadWorkspace}>
          Download {mode}
        </button>
        <button type="button" className="ghost-button" disabled={loading === "workspace"} onClick={() => workspaceInputRef.current?.click()}>
          {loading === "workspace" ? "Loading…" : "Upload Tree / Brick"}
        </button>
        <input
          ref={workspaceInputRef}
          hidden
          type="file"
          accept=".json,.bricktree.json,application/json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importFile(file, "workspace");
          }}
        />
        <button type="button" className="ghost-button" disabled={!hasSession} onClick={onDownload}>
          Download session
        </button>
        <button type="button" className="ghost-button" disabled={loading === "session"} onClick={() => sessionInputRef.current?.click()}>
          {loading === "session" ? "Loading…" : "Upload session"}
        </button>
        <input
          ref={sessionInputRef}
          hidden
          type="file"
          accept=".json,.bricktree.json,application/json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importFile(file, "session");
          }}
        />
      </div>
      <small>
        Brick Tree remains stateless on the server. Exported files can contain extracted source text and should be treated as private when the source material is private.
      </small>
      {message ? <p className="session-transfer-success">{message}</p> : null}
      {error ? <p className="source-error">{error}</p> : null}
    </section>
  );
}
