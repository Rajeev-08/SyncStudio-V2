import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import type * as monaco from "monaco-editor";
import {
  Files,
  Terminal as TerminalIcon,
  Play,
  Search,
  Users,
  GitBranch,
  Sparkles,
  Activity,
  Settings as SettingsIcon,
  MessageSquare,
  PanelLeftClose,
  PanelRight,
  Command,
  X,
  ChevronRight,
  Check,
  Save,
  Download,
  Code2,
  ArrowLeft,
} from "lucide-react";
import type { Workspace, User } from "../../../../packages/shared/src/index";
import { language } from "../../../../packages/shared/src/index";
import { api, download } from "../lib/api";
import { useFileTool } from "../lib/webmcp";
import { Collaboration } from "../lib/collaboration";
import { Avatar, Empty, Modal, useToast } from "./UI";
import { Explorer } from "./Explorer";
import { CodeEditor, type EditorSettings } from "./Editor";
import { RuntimePanel } from "./Runtime";
import { LocalTools } from "./LocalTools";
import { Preview } from "./Preview";
import { History } from "./History";
import {
  Members,
  Comments,
  ActivityPanel,
  SearchPanel,
  AIPanel,
  Settings,
} from "./Panels";
const sections = [
  { id: "explorer", icon: Files, label: "Explorer" },
  { id: "search", icon: Search, label: "Search" },
  { id: "members", icon: Users, label: "Members" },
  { id: "history", icon: GitBranch, label: "Version history" },
  { id: "comments", icon: MessageSquare, label: "Comments" },
  { id: "ai", icon: Sparkles, label: "AI assistant" },
  { id: "activity", icon: Activity, label: "Activity" },
  { id: "settings", icon: SettingsIcon, label: "Settings" },
];
function preferences<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
export function WorkspacePage({ user }: { user: User }) {
  const { projectId } = useParams(),
    qc = useQueryClient(),
    navigate = useNavigate(),
    toast = useToast();
  const p = useQuery({
    queryKey: ["workspace", projectId],
    queryFn: () => api<Workspace>(`/projects/${projectId}`),
  });
  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["workspace", projectId] });
  }, [qc, projectId]);
  if (p.isLoading) return <div className="boot">Opening workspace…</div>;
  if (p.isError || !p.data)
    return (
      <div className="fatal">
        <h2>Couldn’t open this project</h2>
        <p>{p.error?.message ?? "Project not found."}</p>
        <Link to="/">Back to projects</Link>
      </div>
    );
  return (
    <IDE
      key={`${projectId}:${p.data.epoch}:${p.data.role}`}
      project={p.data}
      user={user}
      refresh={refresh}
      onDeleted={() => {
        toast("Project deleted");
        void qc.invalidateQueries({ queryKey: ["projects"] });
        navigate("/");
      }}
    />
  );
}
function IDE({
  project,
  user,
  refresh,
  onDeleted,
}: {
  project: Workspace;
  user: User;
  refresh: () => void;
  onDeleted: () => void;
}) {
  const runtimeOptions = useQuery({
    queryKey: ["runtime-options"],
    queryFn: () => api<{ enabled: boolean }>("/runtime/options"),
  });
  const toast = useToast(),
    [section, setSection] = useState("explorer"),
    [runtimeOpen, setRuntimeOpen] = useState(false),
    [runSignal, setRunSignal] = useState(0),
    [terminalSignal, setTerminalSignal] = useState(0),
    [sidebar, setSidebar] = useState(true),
    [preview, setPreview] = useState(
      ["vanilla", "react", "javascript", "typescript"].includes(
        project.template,
      ),
    ),
    [settings, setSettings] = useState<EditorSettings>(() =>
      preferences("syncstudio:editor", {
        fontSize: 14,
        minimap: false,
        wrap: true,
        theme: "dark",
      }),
    ),
    [tabs, setTabs] = useState<string[]>(() => {
      const fallback = project.files
        .filter((f) => f.type === "file")
        .slice(0, 3)
        .map((f) => f.id);
      const stored = preferences<unknown>(
        `syncstudio:tabs:${project.id}`,
        fallback,
      );
      if (!Array.isArray(stored)) return fallback;
      const valid = stored.filter(
        (id): id is string =>
          typeof id === "string" && project.files.some((f) => f.id === id),
      );
      return stored.length && !valid.length ? fallback : valid;
    }),
    [active, setActive] = useState(() => tabs[0] ?? ""),
    [selection, setSelection] = useState({ text: "", line: 1, endLine: 1 }),
    [palette, setPalette] = useState<"commands" | "files" | null>(null),
    [paletteQuery, setPaletteQuery] = useState(""),
    [newFile, setNewFile] = useState(0),
    [tick, setTick] = useState(0),
    [collab, setCollab] = useState<Collaboration | null>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null),
    pendingLine = useRef<number | null>(null),
    meta = useRef(refresh),
    error = useRef(toast);
  meta.current = refresh;
  error.current = toast;
  useEffect(() => {
    const c = new Collaboration(
      project,
      () => meta.current(),
      () => {
        error.current("Workspace access or version changed. Reloading…");
        meta.current();
      },
      (e) => error.current(e.message, true),
    );
    setCollab(c);
    const stop = c.subscribe(() => setTick((t) => t + 1));
    return () => {
      stop();
      void c.close();
    };
  }, [project.id, project.epoch]);
  useEffect(() => {
    if (collab)
      void collab.addFiles(project).catch((e) => toast(e.message, true));
    setTabs((t) => t.filter((id) => project.files.some((f) => f.id === id)));
    if (active && !project.files.some((f) => f.id === active)) setActive("");
  }, [project]);
  useEffect(() => {
    localStorage.setItem("syncstudio:editor", JSON.stringify(settings));
  }, [settings]);
  useEffect(() => {
    localStorage.setItem(`syncstudio:tabs:${project.id}`, JSON.stringify(tabs));
  }, [tabs, project.id]);
  const files = useMemo(
    () =>
      project.files.map((f) => ({
        ...f,
        content: collab?.content(f.id) ?? f.content,
      })),
    [project.files, collab, tick],
  );
  const file = files.find((f) => f.id === active),
    doc = collab?.docs.get(active),
    canEdit = project.role !== "VIEWER";
  const save = useCallback(async () => {
    if (!collab) throw new Error("Workspace is connecting.");
    await collab.saveAll();
  }, [collab]);
  const open = useCallback(
    (id: string, line?: number) => {
      const f = project.files.find((f) => f.id === id);
      if (!f || f.type !== "file") return;
      setTabs((t) => (t.includes(id) ? t : [...t, id]));
      setActive(id);
      setSelection({ text: "", line: line ?? 1, endLine: line ?? 1 });
      pendingLine.current = line ?? null;
      if (id === active && line) {
        editor.current?.revealLineInCenter(line);
        editor.current?.setPosition({ lineNumber: line, column: 1 });
        pendingLine.current = null;
      }
    },
    [project.files, active],
  );
  useEffect(() => {
    if (collab && active) {
      collab.activeFile = active;
      void collab.publishPresence(active);
    }
  }, [collab, active, doc?.ready]);
  const openPalette = (kind: "commands" | "files") => {
    setPaletteQuery("");
    setPalette(kind);
  };
  const doSave = () => {
    void save()
      .then(() => toast("All changes saved"))
      .catch((e) => toast(e.message, true));
  };
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        doSave();
      }
      if (key === "p") {
        e.preventDefault();
        openPalette(e.shiftKey ? "commands" : "files");
      }
      if (key === "b") {
        e.preventDefault();
        setSidebar((s) => !s);
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const index = tabs.indexOf(active);
        setActive(
          tabs[(index + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length] ??
            "",
        );
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [collab, active, tabs]);
  useFileTool(open, project.files);
  const closeTab = (id: string) => {
    setTabs((t) => t.filter((x) => x !== id));
    if (active === id) setActive(tabs.filter((x) => x !== id).at(-1) ?? "");
  };
  const commands = [
    { label: "Save all files", action: doSave },
    {
      label: "Create file",
      action: () => {
        if (canEdit) {
          setSection("explorer");
          setSidebar(true);
          setNewFile((n) => n + 1);
        }
      },
    },
    { label: "Open full IDE and terminal", action: () => setRuntimeOpen(true) },
    { label: "Toggle preview", action: () => setPreview((p) => !p) },
    { label: "Toggle sidebar", action: () => setSidebar((s) => !s) },
    {
      label: "Create snapshot",
      action: () => {
        setSection("history");
        setSidebar(true);
      },
    },
    {
      label: "Invite collaborator",
      action: () => {
        setSection("members");
        setSidebar(true);
      },
    },
    {
      label: "Open AI assistant",
      action: () => {
        setSection("ai");
        setSidebar(true);
      },
    },
    {
      label: "Format document",
      action: () => {
        void editor.current?.getAction("editor.action.formatDocument")?.run();
      },
    },
    {
      label: "Change theme",
      action: () =>
        setSettings((s) => ({
          ...s,
          theme: s.theme === "dark" ? "light" : "dark",
        })),
    },
    {
      label: "Close other tabs",
      action: () => setTabs(active ? [active] : []),
    },
    {
      label: "Close all tabs",
      action: () => {
        setTabs([]);
        setActive("");
      },
    },
    {
      label: "Export project as JSON",
      action: () =>
        download(
          `${project.name}.json`,
          JSON.stringify(
            {
              name: project.name,
              files: files.map(({ state: _state, ...f }) => f),
            },
            null,
            2,
          ),
        ),
    },
  ];
  const cursorStyles = (collab?.people ?? [])
    .map(
      (p) =>
        `.yRemoteSelection-${p.clientId}{background:${p.user.colorLight}}.yRemoteSelectionHead-${p.clientId}{border-color:${p.user.color}}.yRemoteSelectionHead-${p.clientId}::after{content:${JSON.stringify(p.user.username)};background:${p.user.color};color:#14151b;padding:2px 4px;position:absolute;top:-20px;left:-2px;font:12px system-ui;white-space:nowrap}`,
    )
    .join("\n");
  return (
    <div className={`ide ${settings.theme === "light" ? "light" : ""}`}>
      <style>{cursorStyles}</style>
      {runtimeOpen && (
        <RuntimePanel
          project={project}
          refresh={refresh}
          onClose={() => setRuntimeOpen(false)}
        />
      )}
      <header className="ide-top">
        <div className="ide-brand">
          <Link title="Back to projects" to="/">
            <Code2 size={23} />
          </Link>
          <Link to="/" className="workspace-back">
            <ArrowLeft size={14} />
            Projects
          </Link>
          <ChevronRight size={14} />
          <strong>{project.name}</strong>
          <span className="badge">{project.role.toLowerCase()}</span>
        </div>
        <button
          className="command-trigger"
          onClick={() => openPalette("commands")}
        >
          <Search size={14} />
          <span>Search files and commands</span>
          <kbd>Ctrl ⇧ P</kbd>
        </button>
        <div className="ide-top-actions">
          <button
            disabled={project.role === "VIEWER"}
            onClick={() =>
              runtimeOptions.data?.enabled
                ? setRuntimeOpen(true)
                : setTerminalSignal((n) => n + 1)
            }
          >
            <TerminalIcon size={16} />
            Terminal
          </button>
          {project.role !== "VIEWER" && (
            <button
              onClick={() => setRuntimeOpen(true)}
              title="Terminal, languages, Git, and debugging"
            >
              <Code2 size={16} />
              Full IDE
            </button>
          )}
          <div className="avatars">
            {[
              ...new Map(
                (collab?.people ?? []).map((p) => [p.user.id, p]),
              ).values(),
            ]
              .slice(0, 4)
              .map((p) => (
                <Avatar
                  key={p.user.id}
                  name={p.user.username}
                  color={p.user.color}
                  size="small"
                />
              ))}
          </div>
          <button
            onClick={() => {
              setSection("members");
              setSidebar(true);
            }}
          >
            <Users size={16} />
            <span>Share</span>
          </button>
          <button
            className="primary small-button"
            onClick={() => setPreview((p) => !p)}
          >
            <PanelRight size={15} />
            <span>Preview</span>
          </button>
        </div>
      </header>
      <div className="mobile-notice">
        For the full editing experience, use a wider screen.
      </div>
      <div className="ide-body">
        <nav className="activity-bar" aria-label="Workspace panels">
          {sections.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              className={section === id && sidebar ? "active" : ""}
              title={label}
              aria-label={label}
              onClick={() => {
                setSection(id);
                setSidebar(section === id ? !sidebar : true);
              }}
            >
              <Icon size={21} />
              {id === "ai" && <span className="ai-dot" />}
            </button>
          ))}
          <div className="activity-user">
            <Avatar name={user.username} size="small" />
          </div>
        </nav>
        {sidebar && (
          <aside className="ide-sidebar">
            {section === "explorer" && (
              <Explorer
                projectId={project.id}
                files={files}
                active={active}
                canEdit={canEdit}
                onOpen={open}
                onChange={refresh}
                createSignal={newFile}
              />
            )}{" "}
            {section === "search" && (
              <SearchPanel files={files} onOpen={open} />
            )}{" "}
            {section === "members" && (
              <Members
                project={project}
                presence={collab?.people ?? []}
                onChange={refresh}
              />
            )}{" "}
            {section === "history" && (
              <History
                project={project}
                files={files}
                onChange={refresh}
                saveAll={save}
                theme={settings.theme}
              />
            )}{" "}
            {section === "comments" && (
              <Comments
                project={project}
                file={file}
                selection={selection}
                onChange={refresh}
                onOpen={open}
              />
            )}{" "}
            {section === "activity" && <ActivityPanel project={project} />}{" "}
            {section === "settings" && (
              <Settings
                project={project}
                settings={settings}
                onSettings={setSettings}
                onChange={refresh}
                onDeleted={onDeleted}
              />
            )}{" "}
            {section === "ai" && (
              <AIPanel
                project={project}
                file={file}
                selection={selection.text}
                theme={settings.theme}
                saveAll={save}
                apply={(id, base, code) => {
                  const d = collab?.docs.get(id);
                  if (!d?.ready) throw new Error("File is not ready.");
                  const text = d.doc.getText("content");
                  if (text.toString() !== base)
                    throw new Error(
                      "This file changed while the suggestion was generated. Ask for a fresh suggestion.",
                    );
                  d.doc.transact(() => {
                    text.delete(0, text.length);
                    text.insert(0, code);
                  });
                  toast("AI suggestion applied.");
                }}
              />
            )}
            <div className="sidebar-footer">
              <button
                aria-label="Collapse sidebar"
                onClick={() => setSidebar(false)}
              >
                <PanelLeftClose size={15} />
              </button>
              <span>
                {project.files.filter((f) => f.type === "file").length} files
              </span>
            </div>
          </aside>
        )}
        <main className="editor-pane">
          <div className="editor-tabs" role="tablist">
            {tabs.map((id) => {
              const f = files.find((f) => f.id === id);
              if (!f) return null;
              return (
                <div
                  className={`editor-tab ${active === id ? "active" : ""}`}
                  key={id}
                >
                  <button
                    role="tab"
                    aria-selected={active === id}
                    onClick={() => open(id)}
                  >
                    <span className={"file-type " + f.path.split(".").pop()}>
                      {f.path.endsWith(".html")
                        ? "〈〉"
                        : f.path.endsWith(".css")
                          ? "#"
                          : (f.path.split(".").pop() ?? "txt").toUpperCase()}
                    </span>
                    {f.path.split("/").pop()}
                    {(collab?.docs.get(id)?.pending.length ?? 0) > 0 && (
                      <span title="Unsaved changes">●</span>
                    )}
                  </button>
                  <button
                    aria-label={`Close ${f.path}`}
                    onClick={() => closeTab(id)}
                  >
                    <X size={13} />
                  </button>
                </div>
              );
            })}
            <button
              className="tab-add"
              aria-label="Quick open"
              onClick={() => openPalette("files")}
            >
              +
            </button>
          </div>
          {file ? (
            <>
              <div className="editor-breadcrumb">
                <span>{project.name}</span>
                <ChevronRight size={12} />
                <span>{file.path}</span>
                <div className="editor-tools">
                  <button
                    title="Run this file in the local Output panel"
                    onClick={() => setRunSignal((n) => n + 1)}
                    disabled={!canEdit}
                  >
                    <Play size={14} />
                    Run
                  </button>
                  <button
                    title="Download file"
                    onClick={() =>
                      download(file.path.split("/").pop()!, file.content)
                    }
                  >
                    <Download size={14} />
                  </button>
                  <button title="Save all files" onClick={doSave}>
                    <Save size={14} />
                  </button>
                </div>
              </div>
              {doc?.ready ? (
                <CodeEditor
                  key={file.id}
                  path={file.path}
                  document={doc}
                  readOnly={!canEdit}
                  settings={settings}
                  onSelection={setSelection}
                  onReady={(instance) => {
                    editor.current = instance;
                    if (instance && pendingLine.current) {
                      instance.revealLineInCenter(pendingLine.current);
                      instance.setPosition({
                        lineNumber: pendingLine.current,
                        column: 1,
                      });
                      pendingLine.current = null;
                    }
                  }}
                />
              ) : (
                <Empty title="Synchronizing document…">
                  <p className="muted">{collab?.status}</p>
                  <button onClick={() => void collab?.synchronize()}>
                    Retry connection
                  </button>
                </Empty>
              )}
            </>
          ) : (
            <Empty title="A space for your next idea">
              <p className="muted">
                Open a file from the explorer to start building.
              </p>
              <button onClick={() => openPalette("files")}>
                <Command size={16} />
                Open file <kbd>Ctrl P</kbd>
              </button>
            </Empty>
          )}
          <LocalTools
            project={project}
            file={file}
            saveAll={save}
            runSignal={runSignal}
            terminalSignal={terminalSignal}
          />
          <div className="editor-bottom">
            <span>
              <Check size={13} />{" "}
              {canEdit ? "Changes save automatically" : "Read-only workspace"}
            </span>
            <button
              onClick={() => {
                void editor.current
                  ?.getAction("editor.action.formatDocument")
                  ?.run();
              }}
            >
              Format document
            </button>
          </div>
        </main>
        {preview && <Preview files={files} onClose={() => setPreview(false)} />}
      </div>
      <footer className="status-bar">
        <div>
          <GitBranch size={13} />
          <span>workspace</span>
          <span className="status-divider" />
          <button
            onClick={() => {
              void collab?.synchronize();
            }}
          >
            {collab?.status ?? "Connecting…"}
          </button>
        </div>
        <div>
          <span>{collab?.people.length ?? 0} connected</span>
          <span>
            Ln {selection.line}, Col{" "}
            {editor.current?.getPosition()?.column ?? 1}
          </span>
          <span>Spaces: 2</span>
          <span>UTF-8</span>
          <span>{file ? language(file.path) : ""}</span>
          <button
            title="Command palette"
            onClick={() => openPalette("commands")}
          >
            <Command size={13} />
          </button>
        </div>
      </footer>
      {palette && (
        <Modal
          title={palette === "files" ? "Open file" : "Command palette"}
          onClose={() => setPalette(null)}
        >
          <input
            autoFocus
            aria-label="Search commands or files"
            placeholder={
              palette === "files" ? "Search files by name…" : "Type a command…"
            }
            value={paletteQuery}
            onChange={(e) => setPaletteQuery(e.target.value)}
          />
          <div className="palette-results">
            {palette === "commands"
              ? commands
                  .filter((c) =>
                    c.label.toLowerCase().includes(paletteQuery.toLowerCase()),
                  )
                  .map((c) => (
                    <button
                      key={c.label}
                      onClick={() => {
                        c.action();
                        setPalette(null);
                      }}
                    >
                      <Command size={15} />
                      {c.label}
                    </button>
                  ))
              : files
                  .filter(
                    (f) =>
                      f.type === "file" &&
                      f.path.toLowerCase().includes(paletteQuery.toLowerCase()),
                  )
                  .map((f) => (
                    <button
                      key={f.id}
                      onClick={() => {
                        open(f.id);
                        setPalette(null);
                      }}
                    >
                      <Files size={15} />
                      {f.path}
                    </button>
                  ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
