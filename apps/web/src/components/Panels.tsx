import { useState } from "react";
import { UserPlus, Send, Check, MessageSquare, Sparkles } from "lucide-react";
import type {
  Workspace,
  Presence,
  FileNode,
} from "../../../../packages/shared/src/index";
import { api } from "../lib/api";
import { Avatar, Modal, timeAgo, useToast } from "./UI";
import { DiffModal } from "./History";
import type { EditorSettings } from "./Editor";
export function Members({
  project,
  presence,
  onChange,
}: {
  project: Workspace;
  presence: Presence[];
  onChange: () => void;
}) {
  const toast = useToast(),
    [remove, setRemove] = useState<string | null>(null);
  return (
    <>
      <div className="sidebar-heading">
        MEMBERS <span className="count">{project.people.length}</span>
      </div>
      <div className="sidebar-body">
        {project.role === "OWNER" && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              try {
                await api(
                  `/projects/${project.id}/members`,
                  "POST",
                  Object.fromEntries(new FormData(form)),
                );
                form.reset();
                onChange();
                toast("Member added");
              } catch (e) {
                toast((e as Error).message, true);
              }
            }}
          >
            <label>
              Email
              <input
                name="email"
                type="email"
                required
                placeholder="teammate@example.com"
              />
            </label>
            <label>
              Role
              <select name="role">
                <option value="EDITOR">
                  Editor · Can edit and collaborate
                </option>
                <option value="VIEWER">Viewer · Read only</option>
              </select>
            </label>
            <button className="primary full">
              <UserPlus size={16} />
              Add member
            </button>
            <p className="muted small">
              Members need an existing SyncStudio account.
            </p>
          </form>
        )}
        <p className="section-label">PROJECT MEMBERS</p>
        {project.people.map((person) => {
          const online = presence.find((p) => p.user.id === person.id);
          return (
            <div className="member" key={person.id}>
              <Avatar name={person.username} color={online?.user.color} />
              <div>
                <strong>{person.username}</strong>
                <small>
                  {online ? "Online" : "Offline"} · {person.role.toLowerCase()}
                </small>
                {online && (
                  <small>
                    {project.files.find((f) => f.id === online.fileId)?.path}
                  </small>
                )}
                {project.role === "OWNER" && person.role !== "OWNER" && (
                  <div className="member-tools">
                    <select
                      aria-label={`Role for ${person.username}`}
                      value={person.role}
                      onChange={async (e) => {
                        try {
                          await api(
                            `/projects/${project.id}/members/${person.id}`,
                            "PATCH",
                            { role: e.target.value },
                          );
                          onChange();
                        } catch (e) {
                          toast((e as Error).message, true);
                        }
                      }}
                    >
                      <option>EDITOR</option>
                      <option>VIEWER</option>
                    </select>
                    <button
                      className="danger"
                      onClick={() => setRemove(person.id)}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {remove && (
        <Modal title="Remove member?" onClose={() => setRemove(null)}>
          <p>This person will lose access to the project immediately.</p>
          <div className="modal-actions">
            <button onClick={() => setRemove(null)}>Cancel</button>
            <button
              className="danger-button"
              onClick={async () => {
                try {
                  await api(
                    `/projects/${project.id}/members/${remove}`,
                    "DELETE",
                  );
                  setRemove(null);
                  onChange();
                } catch (e) {
                  toast((e as Error).message, true);
                }
              }}
            >
              Remove member
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
export function Comments({
  project,
  file,
  selection,
  onChange,
  onOpen,
}: {
  project: Workspace;
  file?: FileNode;
  selection: { line: number; endLine: number };
  onChange: () => void;
  onOpen: (id: string, line: number) => void;
}) {
  const toast = useToast(),
    [all, setAll] = useState(false),
    [resolved, setResolved] = useState(false);
  const canEdit = project.role !== "VIEWER";
  return (
    <>
      <div className="sidebar-heading">COMMENTS</div>
      <div className="sidebar-body">
        {file && canEdit && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              try {
                await api(`/projects/${project.id}/comments`, "POST", {
                  fileId: file.id,
                  line: selection.line,
                  endLine: selection.endLine,
                  body: new FormData(form).get("body"),
                });
                form.reset();
                onChange();
              } catch (e) {
                toast((e as Error).message, true);
              }
            }}
          >
            <label>
              Comment on lines {selection.line}–{selection.endLine}
              <textarea
                name="body"
                required
                maxLength={4000}
                placeholder="Start a conversation…"
              />
            </label>
            <button className="primary full">
              <MessageSquare size={15} />
              Add comment
            </button>
          </form>
        )}
        <label className="check-label">
          <input
            type="checkbox"
            checked={all}
            onChange={(e) => setAll(e.target.checked)}
          />
          All files
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={resolved}
            onChange={(e) => setResolved(e.target.checked)}
          />
          Show resolved
        </label>
        {project.comments
          .filter(
            (c) => (all || c.fileId === file?.id) && (resolved || !c.resolved),
          )
          .map((c) => (
            <article key={c.id} className="comment">
              <button
                className="comment-location"
                onClick={() => onOpen(c.fileId, c.line)}
              >
                {project.files.find((f) => f.id === c.fileId)?.path}:{c.line}
              </button>
              <small>
                {c.author} · {timeAgo(c.createdAt)}
              </small>
              <p>{c.body}</p>
              {c.replies.map((r, i) => (
                <div className="reply" key={i}>
                  <small>
                    {r.author} · {timeAgo(r.createdAt)}
                  </small>
                  <p>{r.body}</p>
                </div>
              ))}
              {canEdit && (
                <>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      try {
                        await api(
                          `/projects/${project.id}/comments/${c.id}`,
                          "PATCH",
                          { reply: new FormData(form).get("reply") },
                        );
                        form.reset();
                        onChange();
                      } catch (e) {
                        toast((e as Error).message, true);
                      }
                    }}
                  >
                    <div className="inline-input">
                      <input
                        name="reply"
                        aria-label="Reply"
                        placeholder="Reply…"
                        required
                        maxLength={4000}
                      />
                      <button aria-label="Send reply">
                        <Send size={14} />
                      </button>
                    </div>
                  </form>
                  <button
                    className="text-button"
                    onClick={async () => {
                      try {
                        await api(
                          `/projects/${project.id}/comments/${c.id}`,
                          "PATCH",
                          { resolved: !c.resolved },
                        );
                        onChange();
                      } catch (e) {
                        toast((e as Error).message, true);
                      }
                    }}
                  >
                    <Check size={14} />
                    {c.resolved ? "Reopen" : "Resolve thread"}
                  </button>
                </>
              )}
            </article>
          ))}
        {!project.comments.length && (
          <p className="muted">Select code in the editor to start a thread.</p>
        )}
        <p className="muted small">
          Comments refer to the line numbers selected when posted.
        </p>
      </div>
    </>
  );
}
export function ActivityPanel({ project }: { project: Workspace }) {
  return (
    <>
      <div className="sidebar-heading">ACTIVITY</div>
      <div className="sidebar-body">
        {project.activity.map((a) => (
          <div className="activity-item" key={a.id}>
            <Avatar name={a.actor} size="small" />
            <div>
              <p>
                <strong>{a.actor}</strong> {a.action}
              </p>
              <span>{a.target}</span>
              <small>{timeAgo(a.createdAt)}</small>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
export function SearchPanel({
  files,
  onOpen,
}: {
  files: FileNode[];
  onOpen: (id: string, line?: number) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.toLowerCase();
  const results = q
    ? files
        .flatMap((f) => {
          const matches =
            f.type === "file"
              ? f.content
                  .split("\n")
                  .flatMap((text, index) =>
                    text.toLowerCase().includes(q)
                      ? [{ id: f.id, path: f.path, line: index + 1, text }]
                      : [],
                  )
              : [];
          if (f.path.toLowerCase().includes(q))
            matches.unshift({
              id: f.id,
              path: f.path,
              line: 1,
              text: f.type === "folder" ? "Folder" : "Filename match",
            });
          return matches;
        })
        .slice(0, 100)
    : [];
  return (
    <>
      <div className="sidebar-heading">SEARCH</div>
      <div className="sidebar-body">
        <input
          aria-label="Search workspace"
          autoFocus
          placeholder="Search files and code…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <p className="muted small">
          {q
            ? `${results.length} results${results.length === 100 ? " (first 100)" : ""}`
            : "Find something across your project."}
        </p>
        {results.map((r, i) => (
          <button
            className="search-result"
            key={i}
            onClick={() => onOpen(r.id, r.line)}
          >
            <strong>
              {r.path}:{r.line}
            </strong>
            <code>{r.text.trim().slice(0, 150)}</code>
          </button>
        ))}
      </div>
    </>
  );
}
interface AIResponse {
  explanation: string;
  code: string | null;
  baseContent: string;
  fileId: string;
}
export function AIPanel({
  project,
  file,
  selection,
  apply,
  saveAll,
  theme,
}: {
  project: Workspace;
  file?: FileNode;
  selection: string;
  apply: (id: string, base: string, code: string) => void;
  saveAll: () => Promise<void>;
  theme: "dark" | "light";
}) {
  const [question, setQuestion] = useState(""),
    [answer, setAnswer] = useState<AIResponse | null>(null),
    [busy, setBusy] = useState(false),
    [diff, setDiff] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <div className="sidebar-heading">
        <span>
          <Sparkles size={14} />
          AI ASSISTANT
        </span>
      </div>
      <div className="sidebar-body">
        <p className="muted">
          Ask about your code or review a suggested change.
        </p>
        <div className="ai-context">
          {file?.path ?? "Select a file"}
          {selection && <span>Selection included</span>}
        </div>
        <div className="ai-prompts">
          {[
            "Explain this code",
            "Find potential bugs",
            "Refactor this file",
            "Write tests for this file",
          ].map((q) => (
            <button key={q} onClick={() => setQuestion(q)}>
              {q}
            </button>
          ))}
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!file) return;
            setBusy(true);
            setError("");
            try {
              if (project.role !== "VIEWER") await saveAll();
              setAnswer(
                await api<AIResponse>(`/projects/${project.id}/ai`, "POST", {
                  fileId: file.id,
                  question,
                  selection,
                }),
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <textarea
            aria-label="Ask AI"
            placeholder="How can I improve this code?"
            required
            maxLength={3000}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button className="primary full" disabled={!file || busy}>
            <Sparkles size={16} />
            {busy ? "Thinking…" : "Ask assistant"}
          </button>
        </form>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        {answer && (
          <div className="ai-answer">
            <p>{answer.explanation}</p>
            {answer.code !== null && (
              <button onClick={() => setDiff(true)}>
                Review proposed change
              </button>
            )}
          </div>
        )}
        <p className="muted small">
          Code is sent to the configured AI provider. Changes require your
          approval.
        </p>
      </div>
      {diff && answer?.code !== null && answer && (
        <DiffModal
          title="Review AI suggestion"
          path={project.files.find((f) => f.id === answer.fileId)?.path ?? ""}
          original={answer.baseContent}
          modified={answer.code}
          theme={theme}
          onClose={() => setDiff(false)}
          footer={
            <div className="modal-actions">
              <button onClick={() => setDiff(false)}>Discard</button>
              {project.role !== "VIEWER" && (
                <button
                  className="primary"
                  onClick={() => {
                    try {
                      apply(answer.fileId, answer.baseContent, answer.code!);
                      setDiff(false);
                      setAnswer(null);
                    } catch (e) {
                      setError((e as Error).message);
                      setDiff(false);
                    }
                  }}
                >
                  Apply change
                </button>
              )}
            </div>
          }
        />
      )}
    </>
  );
}
export function Settings({
  project,
  settings,
  onSettings,
  onChange,
  onDeleted,
}: {
  project: Workspace;
  settings: EditorSettings;
  onSettings: (settings: EditorSettings) => void;
  onChange: () => void;
  onDeleted: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const toast = useToast();
  return (
    <>
      <div className="sidebar-heading">SETTINGS</div>
      <div className="sidebar-body">
        <h3>Editor</h3>
        <label>
          Theme
          <select
            value={settings.theme}
            onChange={(e) =>
              onSettings({
                ...settings,
                theme: e.target.value as "dark" | "light",
              })
            }
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>
        <label>
          Font size
          <input
            type="number"
            min={12}
            max={28}
            value={settings.fontSize}
            onChange={(e) =>
              onSettings({
                ...settings,
                fontSize: Math.min(28, Math.max(12, Number(e.target.value))),
              })
            }
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={settings.minimap}
            onChange={(e) =>
              onSettings({ ...settings, minimap: e.target.checked })
            }
          />
          Show minimap
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={settings.wrap}
            onChange={(e) =>
              onSettings({ ...settings, wrap: e.target.checked })
            }
          />
          Word wrap
        </label>
        {project.role === "OWNER" && (
          <>
            <h3>Project</h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api(
                    `/projects/${project.id}`,
                    "PATCH",
                    Object.fromEntries(new FormData(e.currentTarget)),
                  );
                  onChange();
                  toast("Project settings saved");
                } catch (e) {
                  toast((e as Error).message, true);
                }
              }}
            >
              <label>
                Name
                <input
                  name="name"
                  required
                  maxLength={80}
                  defaultValue={project.name}
                />
              </label>
              <label>
                Description
                <textarea
                  name="description"
                  maxLength={500}
                  defaultValue={project.description}
                />
              </label>
              <button className="primary full">Save settings</button>
            </form>
            <h3 className="danger">Danger zone</h3>
            <button
              className="danger-button full"
              onClick={() => setConfirm(true)}
            >
              Delete project
            </button>
          </>
        )}
      </div>
      {confirm && (
        <Modal
          title="Delete project permanently?"
          onClose={() => setConfirm(false)}
        >
          <p>
            All files, snapshots, comments and membership records will be
            deleted, including all personal full IDE workspaces for this
            project. Type the project name to confirm.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (new FormData(e.currentTarget).get("name") !== project.name)
                return;
              try {
                await api(`/projects/${project.id}`, "DELETE");
                onDeleted();
              } catch (e) {
                toast((e as Error).message, true);
              }
            }}
          >
            <input
              aria-label="Confirm project name"
              name="name"
              required
              placeholder={project.name}
            />
            <div className="modal-actions">
              <button type="button" onClick={() => setConfirm(false)}>
                Cancel
              </button>
              <button className="danger-button">Delete permanently</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
