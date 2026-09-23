import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen,
  FilePlus2,
  FolderPlus,
  MoreHorizontal,
  Copy,
  Pencil,
  Trash2,
} from "lucide-react";
import type { FileNode } from "../../../../packages/shared/src/index";
import { api } from "../lib/api";
import { Modal, useToast } from "./UI";
export function Explorer({
  projectId,
  files,
  active,
  canEdit,
  onOpen,
  onChange,
  createSignal = 0,
}: {
  projectId: string;
  files: FileNode[];
  active: string;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onChange: () => void;
  createSignal?: number;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set()),
    [dialog, setDialog] = useState<{
      kind: "file" | "folder" | "rename" | "duplicate" | "delete";
      file?: FileNode;
      parent?: string;
    } | null>(null),
    [busy, setBusy] = useState(false);
  const toast = useToast();
  const [seen, setSeen] = useState(createSignal);
  if (seen !== createSignal) {
    setSeen(createSignal);
    if (createSignal) setDialog({ kind: "file" });
  }
  const run = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!dialog) return;
    setBusy(true);
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const base = `/projects/${projectId}/files`;
      if (dialog.kind === "delete")
        await api(`${base}/${dialog.file!.id}`, "DELETE");
      else if (dialog.kind === "rename")
        await api(`${base}/${dialog.file!.id}`, "PATCH", { path: data.path });
      else
        await api(base, "POST", {
          path: data.path,
          type: dialog.kind === "folder" ? "folder" : "file",
          content: dialog.kind === "duplicate" ? dialog.file!.content : "",
        });
      onChange();
      setDialog(null);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  function tree(parent = "", depth = 0): React.ReactNode {
    return files
      .filter(
        (f) =>
          (f.path.includes("/")
            ? f.path.slice(0, f.path.lastIndexOf("/"))
            : "") === parent,
      )
      .sort(
        (a, b) =>
          (a.type === b.type ? 0 : a.type === "folder" ? -1 : 1) ||
          a.path.localeCompare(b.path),
      )
      .map((f) => {
        const folder = f.type === "folder",
          open = !collapsed.has(f.id),
          name = f.path.split("/").pop();
        return (
          <div key={f.id}>
            <div
              className={`file-row ${active === f.id ? "active" : ""}`}
              style={{ paddingLeft: 12 + depth * 14 }}
            >
              <button
                className="file-name"
                onClick={() => {
                  if (folder)
                    setCollapsed((s) => {
                      const next = new Set(s);
                      if (next.has(f.id)) next.delete(f.id);
                      else next.add(f.id);
                      return next;
                    });
                  else onOpen(f.id);
                }}
              >
                {folder ? (
                  <>
                    {open ? (
                      <ChevronDown size={13} />
                    ) : (
                      <ChevronRight size={13} />
                    )}{" "}
                    {open ? <FolderOpen size={15} /> : <Folder size={15} />}
                  </>
                ) : (
                  <FileCode2
                    size={15}
                    className={"file-type " + f.path.split(".").pop()}
                  />
                )}
                <span>{name}</span>
              </button>
              {canEdit && (
                <details className="context-menu">
                  <summary aria-label={`Actions for ${name}`}>
                    <MoreHorizontal size={15} />
                  </summary>
                  <div className="menu-items">
                    {folder && (
                      <>
                        <button
                          onClick={() =>
                            setDialog({ kind: "file", parent: f.path })
                          }
                        >
                          <FilePlus2 size={14} />
                          New file
                        </button>
                        <button
                          onClick={() =>
                            setDialog({ kind: "folder", parent: f.path })
                          }
                        >
                          <FolderPlus size={14} />
                          New folder
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => setDialog({ kind: "rename", file: f })}
                    >
                      <Pencil size={14} />
                      Rename / move
                    </button>
                    {!folder && (
                      <button
                        onClick={() =>
                          setDialog({ kind: "duplicate", file: f })
                        }
                      >
                        <Copy size={14} />
                        Duplicate
                      </button>
                    )}
                    <button
                      className="danger"
                      onClick={() => setDialog({ kind: "delete", file: f })}
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </div>
                </details>
              )}
            </div>
            {folder && open && tree(f.path, depth + 1)}
          </div>
        );
      });
  }
  return (
    <>
      <div className="sidebar-heading">
        <span>EXPLORER</span>
        {canEdit && (
          <div className="actions">
            <button
              title="New file"
              aria-label="New file"
              onClick={() => setDialog({ kind: "file" })}
            >
              <FilePlus2 size={16} />
            </button>
            <button
              title="New folder"
              aria-label="New folder"
              onClick={() => setDialog({ kind: "folder" })}
            >
              <FolderPlus size={16} />
            </button>
          </div>
        )}
      </div>
      <div className="file-tree">
        {tree()}
        {!files.length && (
          <p className="sidebar-hint">No files yet. Create one to begin.</p>
        )}
      </div>
      {dialog && (
        <Modal
          title={
            dialog.kind === "delete"
              ? "Delete " + dialog.file?.path
              : dialog.kind === "rename"
                ? "Rename or move"
                : dialog.kind === "duplicate"
                  ? "Duplicate file"
                  : `New ${dialog.kind}`
          }
          onClose={() => setDialog(null)}
        >
          <form onSubmit={run}>
            {dialog.kind === "delete" ? (
              <p>
                This will delete{" "}
                {dialog.file?.type === "folder"
                  ? "the folder and everything inside it"
                  : "the file"}
                . Create a snapshot first if you may need it later.
              </p>
            ) : (
              <label>
                Path
                <input
                  name="path"
                  required
                  autoFocus
                  maxLength={240}
                  defaultValue={
                    dialog.kind === "rename"
                      ? dialog.file?.path
                      : dialog.kind === "duplicate"
                        ? dialog.file?.path.replace(/(\.[^.]+)?$/, "-copy$1")
                        : dialog.parent
                          ? dialog.parent + "/"
                          : ""
                  }
                  placeholder="src/components/Button.tsx"
                />
              </label>
            )}
            <div className="modal-actions">
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                disabled={busy}
                className={
                  dialog.kind === "delete" ? "danger-button" : "primary"
                }
              >
                {busy
                  ? "Working…"
                  : dialog.kind === "delete"
                    ? "Delete"
                    : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
