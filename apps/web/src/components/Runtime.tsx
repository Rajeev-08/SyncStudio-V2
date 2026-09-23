import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DiffEditor } from "@monaco-editor/react";
import {
  Terminal,
  Play,
  Square,
  ExternalLink,
  RefreshCw,
  Trash2,
  GitCompareArrows,
  Check,
  Cpu,
} from "lucide-react";
import { api } from "../lib/api";
import { Modal, useToast } from "./UI";
import {
  language,
  type Workspace,
} from "../../../../packages/shared/src/index";
const environments = [
  {
    id: "web",
    name: "JavaScript / TypeScript",
    detail: "Node.js · React · npm · Vite",
    command: "npm install && npm run dev",
  },
  {
    id: "python",
    name: "Python",
    detail: "Python · virtual environments · debugger",
    command: "python3 main.py",
  },
  {
    id: "cpp",
    name: "C / C++",
    detail: "GCC · Clang · CMake · LLDB",
    command: "g++ -g main.cpp -o /tmp/app && /tmp/app",
  },
  {
    id: "java",
    name: "Java",
    detail: "JDK 21 · Maven · Java debugger",
    command: "java Main.java",
  },
  {
    id: "go",
    name: "Go",
    detail: "Go toolchain · gopls · Delve",
    command: "go run main.go",
  },
  {
    id: "rust",
    name: "Rust",
    detail: "Rust · Cargo · rust-analyzer · LLDB",
    command: "rustc main.rs -o /tmp/app && /tmp/app",
  },
];
interface Status {
  state: "absent" | "running" | "stopped";
  template?: string;
  initialized?: boolean;
  error?: string;
}
interface Review {
  reviewId: string;
  changes: { path: string; kind: string; before: string; after: string }[];
  skipped: { path: string; reason: string }[];
}
export function RuntimePanel({
  project,
  onClose,
  refresh,
}: {
  project: Workspace;
  onClose: () => void;
  refresh: () => void;
}) {
  const toast = useToast(),
    [template, setTemplate] = useState(
      ["python", "cpp", "java", "go", "rust"].includes(project.template)
        ? project.template
        : project.template === "c"
          ? "cpp"
          : "web",
    ),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [review, setReview] = useState<Review | null>(null),
    [selected, setSelected] = useState(0),
    [confirmation, setConfirmation] = useState("");
  const options = useQuery({
    queryKey: ["runtime-options"],
    queryFn: () => api<{ enabled: boolean }>("/runtime/options"),
  });
  const base = `/projects/${project.id}/runtime`;
  const status = useQuery({
    queryKey: ["runtime", project.id],
    queryFn: () => api<Status>(base),
    enabled: options.data?.enabled === true,
    refetchInterval: busy ? false : 10000,
  });
  const env = environments.find(
    (e) => e.id === (status.data?.template ?? template),
  )!;
  const running = status.data?.state === "running";
  async function action(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setError("");
    try {
      await fn();
      await status.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed");
    } finally {
      setBusy("");
    }
  }
  async function launch() {
    const tab = window.open("about:blank", "_blank");
    if (tab) {
      tab.opener = null;
      tab.document.title = "Opening SyncStudio IDE";
    }
    await action("Opening IDE", async () => {
      try {
        const { url } = await api<{ url: string }>(
          base + "/launch",
          "POST",
          {},
        );
        if (tab) tab.location.href = url;
        else window.location.assign(url);
      } catch (e) {
        tab?.close();
        throw e;
      }
    });
  }
  return (
    <Modal title="Full development environment" onClose={onClose} wide>
      <div className="runtime-panel">
        <div className="runtime-heading">
          <div className="runtime-symbol">
            <Terminal size={26} />
          </div>
          <div>
            <h3>{project.name}</h3>
            <p>Your personal workspace · VS Code-based IDE</p>
          </div>
          <span className={`runtime-state ${running ? "running" : ""}`}>
            {busy || status.data?.state || "Not started"}
          </span>
        </div>
        <p className="runtime-intro">
          Edit, install packages, run programs, debug, and use Git in a
          persistent Linux workspace. Your collaborative project is copied on
          first start. IDE edits stay here until you review and import them.
        </p>
        {(error || status.error) && (
          <div className="runtime-error" role="alert">
            {error || status.error?.message}
          </div>
        )}
        {options.isLoading ? (
          <p>Checking workspace service…</p>
        ) : !options.data?.enabled ? (
          <div className="runtime-setup">
            <h3>Start the full application stack</h3>
            <p>
              The collaborative editor is available. Full IDE features require
              the workspace service and Docker Desktop or Docker Engine.
            </p>
            <pre>npm run ide:up</pre>
            <p>
              Then open <strong>http://localhost:3001</strong>. On Windows, use
              Docker Desktop with Linux containers and WSL 2. The first build
              downloads the IDE and language toolchains.
            </p>
          </div>
        ) : (
          <>
            <div className="environment-grid">
              {environments.map((e) => (
                <button
                  key={e.id}
                  className={`environment-card ${(status.data?.template ?? template) === e.id ? "selected" : ""}`}
                  disabled={
                    !!busy ||
                    (!!status.data?.template && status.data.template !== e.id)
                  }
                  onClick={() => setTemplate(e.id)}
                >
                  <span>
                    {e.name}
                    {(status.data?.template ?? template) === e.id && (
                      <Check size={15} />
                    )}
                  </span>
                  <small>{e.detail}</small>
                </button>
              ))}
            </div>
            <div className="runtime-controls">
              {!running ? (
                <button
                  className="primary"
                  disabled={!!busy || status.isLoading}
                  onClick={() =>
                    void action("Starting workspace", async () => {
                      await api(base + "/start", "POST", {
                        template: status.data?.template ?? template,
                      });
                    })
                  }
                >
                  <Play size={16} />
                  {status.data?.state === "stopped"
                    ? "Resume workspace"
                    : "Create workspace"}
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={!!busy}
                  onClick={() => void launch()}
                >
                  <ExternalLink size={16} />
                  Open full IDE
                </button>
              )}
              <button
                disabled={!!busy || !running}
                onClick={() =>
                  void action("Stopping workspace", async () => {
                    await api(base + "/stop", "POST", {});
                    setReview(null);
                  })
                }
              >
                <Square size={15} />
                Stop
              </button>
              <button
                disabled={!!busy || !running || project.role !== "OWNER"}
                title={
                  project.role !== "OWNER"
                    ? "Only the project owner can import files"
                    : "Review IDE changes before importing"
                }
                onClick={() =>
                  void action("Reading workspace files", async () => {
                    setReview(await api<Review>(base + "/review", "POST", {}));
                    setSelected(0);
                  })
                }
              >
                <GitCompareArrows size={16} />
                Review changes
              </button>
              <button
                aria-label="Refresh workspace status"
                disabled={!!busy}
                onClick={() => void status.refetch()}
              >
                <RefreshCw size={16} />
              </button>
            </div>
            {busy && (
              <p role="status">
                {busy}… First startup may take a minute. Keep this window open.
              </p>
            )}
            {status.data?.error && (
              <p className="runtime-error">Last startup: {status.data.error}</p>
            )}
            <div className="runtime-guide">
              <div>
                <h4>Run your project</h4>
                <code>{env.command}</code>
                <p>
                  Use Terminal → New Terminal. The + button creates more
                  terminals; split terminals run side by side. Use tmux new -As
                  work for a session you can reattach after reconnecting. Or run
                  the “Run project” task. Debug configurations are included in
                  .vscode.
                </p>
              </div>
              <div>
                <h4>Preview a web application</h4>
                <p>
                  After starting a server, open <code>/absproxy/5173/</code> on
                  your IDE hostname. Use your application's actual port.
                  Configure the application's base path if its assets use
                  absolute URLs.
                </p>
              </div>
            </div>
            <p className="runtime-limits">
              <Cpu size={15} />2 CPUs · 2 GB RAM · Persistent home folder ·
              Stops after 30 minutes disconnected
            </p>
            <details className="runtime-details">
              <summary>Extensions, Git, and collaboration</summary>
              <p>
                Install compatible extensions from Open VSX inside the IDE.
                Microsoft Marketplace and Live Share are not included. Use
                Source Control to initialize a repository or the terminal to
                clone one. Configure your Git identity and credentials inside
                your own workspace.
              </p>
              <p>
                Live cursors, comments, AI review, and snapshots remain in the
                collaborative editor. Full IDE workspaces are personal. Editors
                can work independently; only the project owner can import
                reviewed files into the shared project.
              </p>
            </details>
            {review && (
              <section className="runtime-review">
                <h3>Review {review.changes.length} changed paths</h3>
                <p>
                  Import replaces the shared file tree, saves a recovery
                  snapshot, and clears comments attached to old file IDs. Review
                  expires in 10 minutes. Save open IDE files before reviewing;
                  this imports the exact contents shown below.
                </p>
                {review.skipped.length > 0 && (
                  <details open>
                    <summary>
                      {review.skipped.length} paths excluded from import
                    </summary>
                    <ul>
                      {review.skipped.map((s) => (
                        <li key={s.path}>
                          <code>{s.path}</code> — {s.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {review.changes.length > 0 ? (
                  <>
                    <div className="runtime-diff">
                      <nav aria-label="Changed files">
                        {review.changes.map((c, i) => (
                          <button
                            key={c.path}
                            className={selected === i ? "active" : ""}
                            onClick={() => setSelected(i)}
                          >
                            <span className={`change-${c.kind}`}>{c.kind}</span>
                            {c.path}
                          </button>
                        ))}
                      </nav>
                      <div className="runtime-diff-editor">
                        <DiffEditor
                          original={review.changes[selected]?.before ?? ""}
                          modified={review.changes[selected]?.after ?? ""}
                          language={language(
                            review.changes[selected]?.path ?? "",
                          )}
                          theme="vs-dark"
                          options={{
                            readOnly: true,
                            renderSideBySide: false,
                            minimap: { enabled: false },
                            automaticLayout: true,
                          }}
                        />
                      </div>
                    </div>
                    <button
                      className="primary"
                      disabled={!!busy}
                      onClick={() =>
                        void action("Importing reviewed files", async () => {
                          const result = await api<{
                            baselineUpdated: boolean;
                          }>(base + "/import", "POST", {
                            reviewId: review.reviewId,
                          });
                          setReview(null);
                          refresh();
                          toast(
                            result.baselineUpdated
                              ? "Imported IDE files. Recovery snapshot saved."
                              : "Files imported. Workspace baseline could not update; recreate it before another import.",
                          );
                          onClose();
                        })
                      }
                    >
                      <Check size={16} />
                      Import reviewed files
                    </button>
                  </>
                ) : (
                  <p>No changes to import.</p>
                )}
              </section>
            )}
            {status.data?.state !== "absent" && (
              <details className="runtime-delete">
                <summary>Delete this personal workspace</summary>
                <p>
                  This permanently removes your IDE files, installed packages,
                  terminal state, and Git credentials. Your collaborative
                  project remains available. Export important files first.
                </p>
                <label>
                  Type DELETE WORKSPACE
                  <input
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    placeholder="DELETE WORKSPACE"
                  />
                </label>
                <button
                  className="danger"
                  disabled={!!busy || confirmation !== "DELETE WORKSPACE"}
                  onClick={() =>
                    void action("Deleting workspace", async () => {
                      await api(base, "DELETE", { confirmation });
                      setConfirmation("");
                      setReview(null);
                    })
                  }
                >
                  <Trash2 size={15} />
                  Delete workspace
                </button>
              </details>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
