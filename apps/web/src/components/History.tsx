import { useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import {
  GitCommitHorizontal,
  RotateCcw,
  SplitSquareHorizontal,
  Trash2,
} from "lucide-react";
import type {
  Workspace,
  Version,
  FileNode,
} from "../../../../packages/shared/src/index";
import { language } from "../../../../packages/shared/src/index";
import { api } from "../lib/api";
import { Modal, timeAgo, useToast } from "./UI";
export function DiffModal({
  title,
  original,
  modified,
  path,
  theme,
  onClose,
  footer,
}: {
  title: string;
  original: string;
  modified: string;
  path: string;
  theme: "dark" | "light";
  onClose: () => void;
  footer?: React.ReactNode;
}) {
  return (
    <Modal title={title} onClose={onClose} wide>
      <p className="muted diff-label">{path} · Previous / Proposed</p>
      <div className="diff-editor">
        <DiffEditor
          height="100%"
          original={original}
          modified={modified}
          language={language(path)}
          theme={theme === "dark" ? "sync-dark" : "vs"}
          options={{
            readOnly: true,
            automaticLayout: true,
            minimap: { enabled: false },
            renderSideBySide: true,
          }}
        />
      </div>
      {footer}
    </Modal>
  );
}
export function History({
  project,
  files,
  onChange,
  saveAll,
  theme,
}: {
  project: Workspace;
  files: FileNode[];
  onChange: () => void;
  saveAll: () => Promise<void>;
  theme: "dark" | "light";
}) {
  const [message, setMessage] = useState(""),
    [version, setVersion] = useState<Version | null>(null),
    [path, setPath] = useState(""),
    [restore, setRestore] = useState<
      Version | Workspace["versions"][number] | null
    >(null),
    [busy, setBusy] = useState(false);
  const toast = useToast();
  const canEdit = project.role !== "VIEWER";
  async function inspect(id: string) {
    try {
      const v = await api<Version>(`/projects/${project.id}/versions/${id}`);
      setVersion(v);
      setPath(v.files.find((f) => f.type === "file")?.path ?? "");
    } catch (e) {
      toast((e as Error).message, true);
    }
  }
  return (
    <>
      <div className="sidebar-heading">VERSION HISTORY</div>
      <div className="sidebar-body">
        {canEdit && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await saveAll();
                await api(`/projects/${project.id}/versions`, "POST", {
                  message,
                });
                setMessage("");
                onChange();
                toast("Snapshot created");
              } catch (e) {
                toast((e as Error).message, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            <textarea
              aria-label="Snapshot message"
              placeholder="What changed?"
              value={message}
              maxLength={150}
              required
              onChange={(e) => setMessage(e.target.value)}
            />
            <button className="primary full" disabled={busy}>
              <GitCommitHorizontal size={16} />
              Create snapshot
            </button>
          </form>
        )}
        <p className="section-label">{project.versions.length} SNAPSHOTS</p>
        {project.versions.length === 0 && (
          <p className="muted">
            Save a milestone to compare changes or return to it later.
          </p>
        )}
        {project.versions.map((v) => (
          <article className="history-item" key={v.id}>
            <GitCommitHorizontal size={18} />
            <div>
              <strong>{v.message}</strong>
              <small>
                {v.author} · {timeAgo(v.createdAt)}
              </small>
              <small>{v.changedFiles} files changed</small>
              <div className="actions">
                <button onClick={() => inspect(v.id)}>
                  <SplitSquareHorizontal size={14} />
                  Compare
                </button>
                {project.role === "OWNER" && (
                  <>
                    <button
                      title="Restore snapshot"
                      onClick={() => setRestore(v)}
                    >
                      <RotateCcw size={14} />
                    </button>
                    <button
                      title="Delete snapshot"
                      onClick={async () => {
                        try {
                          await api(
                            `/projects/${project.id}/versions/${v.id}`,
                            "DELETE",
                          );
                          onChange();
                        } catch (e) {
                          toast((e as Error).message, true);
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      {version && (
        <Modal
          title={`Compare · ${version.message}`}
          wide
          onClose={() => setVersion(null)}
        >
          <select
            aria-label="File to compare"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          >
            {[
              ...new Set(
                [...version.files, ...files]
                  .filter((f) => f.type === "file")
                  .map((f) => f.path),
              ),
            ].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <p className="muted diff-label">Snapshot / Current workspace</p>
          <div className="diff-editor">
            <DiffEditor
              original={
                version.files.find((f) => f.path === path)?.content ?? ""
              }
              modified={files.find((f) => f.path === path)?.content ?? ""}
              language={language(path)}
              theme={theme === "dark" ? "sync-dark" : "vs"}
              options={{ readOnly: true, automaticLayout: true }}
            />
          </div>
        </Modal>
      )}
      {restore && (
        <Modal title="Restore snapshot?" onClose={() => setRestore(null)}>
          <p>
            Restore “{restore.message}”? A recovery snapshot of the current
            saved files will be created first. Open editors will reload and
            comments will be cleared.
          </p>
          <div className="modal-actions">
            <button onClick={() => setRestore(null)}>Cancel</button>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await saveAll();
                  await api(
                    `/projects/${project.id}/versions/${restore.id}/restore`,
                    "POST",
                  );
                  setRestore(null);
                  onChange();
                  toast("Snapshot restored. A recovery copy was saved.");
                } catch (e) {
                  toast((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Restore snapshot
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
