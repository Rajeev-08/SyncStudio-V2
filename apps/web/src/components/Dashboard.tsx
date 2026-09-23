import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
  Plus,
  Search,
  FolderOpen,
  Users,
  LayoutGrid,
  LogOut,
  ArrowUpRight,
  Copy,
  Clock,
  Code2,
} from "lucide-react";
import type {
  ProjectSummary,
  User,
} from "../../../../packages/shared/src/index";
import { api } from "../lib/api";
import { Avatar, Empty, Logo, Modal, timeAgo, useToast } from "./UI";
export function Dashboard({ user }: { user: User }) {
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [create, setCreate] = useState(false),
    [busy, setBusy] = useState(false);
  const qc = useQueryClient(),
    navigate = useNavigate(),
    toast = useToast();
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<ProjectSummary[]>("/projects"),
  });
  const visible =
    projects.data
      ?.filter(
        (p) =>
          (p.name + " " + p.description)
            .toLowerCase()
            .includes(query.toLowerCase()) &&
          (filter === "all" ||
            filter === "recent" ||
            (filter === "owned" ? p.owner === user.id : p.owner !== user.id)),
      )
      .slice(0, filter === "recent" ? 6 : 50) ?? [];
  return (
    <div className="dashboard">
      <aside className="dashboard-nav">
        <Logo />
        <div className="nav-section">WORKSPACE</div>
        {[
          { id: "all", label: "All projects", icon: LayoutGrid },
          { id: "recent", label: "Recent", icon: Clock },
          { id: "owned", label: "My projects", icon: FolderOpen },
          { id: "shared", label: "Shared with me", icon: Users },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={filter === id ? "active" : ""}
            onClick={() => setFilter(id)}
          >
            <Icon size={18} />
            {label}
            {id === "all" && (
              <span className="count">{projects.data?.length ?? 0}</span>
            )}
          </button>
        ))}
        <div className="nav-bottom">
          <Avatar name={user.username} />
          <div>
            <strong>{user.username}</strong>
            <small>{user.email}</small>
          </div>
          <button
            title="Sign out"
            aria-label="Sign out"
            onClick={async () => {
              try {
                await api("/auth/logout", "POST");
                qc.clear();
                navigate("/login");
              } catch (e) {
                toast((e as Error).message, true);
              }
            }}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <main className="dashboard-main">
        <header className="dashboard-top">
          <span>
            Workspace{" "}
            <span className="muted">
              / {filter === "shared" ? "Shared projects" : "Projects"}
            </span>
          </span>
          <span className="badge">PERSONAL WORKSPACE</span>
        </header>
        <section className="projects-content">
          <div className="page-title">
            <div>
              <span className="eyebrow">LET’S BUILD SOMETHING</span>
              <h1>Your projects</h1>
              <p className="muted">
                Welcome back, {user.username}. Pick up where you left off.
              </p>
            </div>
            <button className="primary" onClick={() => setCreate(true)}>
              <Plus size={18} />
              New project
            </button>
          </div>
          <div className="project-toolbar">
            <div className="search-field">
              <Search size={17} />
              <input
                aria-label="Search projects"
                placeholder="Search projects…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <span className="muted">
              {visible.length} projects · Recently updated
            </span>
          </div>
          {projects.isLoading ? (
            <Empty title="Loading your projects…" />
          ) : projects.isError ? (
            <Empty title="Couldn’t load projects">
              <p>{projects.error.message}</p>
              <button onClick={() => projects.refetch()}>Retry</button>
            </Empty>
          ) : visible.length === 0 ? (
            <Empty
              title={
                query ? "No matching projects" : "Your next idea starts here"
              }
            >
              <p className="muted">
                Create a project to start coding together.
              </p>
              <button onClick={() => setCreate(true)} className="primary">
                <Plus size={17} />
                Create project
              </button>
            </Empty>
          ) : (
            <div className="project-grid">
              {visible.map((p) => (
                <article className="project-card" key={p.id}>
                  <div className="card-top">
                    <span className={`template-icon ${p.template}`}>
                      <Code2 size={24} />
                    </span>
                    <span className="badge">{p.role.toLowerCase()}</span>
                    <button
                      title="Duplicate project"
                      aria-label={`Duplicate ${p.name}`}
                      onClick={async () => {
                        try {
                          const result = await api<{ id: string }>(
                            `/projects/${p.id}/duplicate`,
                            "POST",
                          );
                          navigate(`/workspace/${result.id}`);
                        } catch (e) {
                          toast((e as Error).message, true);
                        }
                      }}
                    >
                      <Copy size={16} />
                    </button>
                  </div>
                  <Link to={`/workspace/${p.id}`} className="project-title">
                    {p.name}
                    <ArrowUpRight size={18} />
                  </Link>
                  <p>{p.description || "A little idea. A shared beginning."}</p>
                  <span className="language-label">
                    {p.template === "vanilla"
                      ? "HTML / CSS / JavaScript"
                      : p.template}
                  </span>
                  <footer>
                    <span>
                      <Users size={14} />
                      {p.memberCount}{" "}
                      {p.memberCount === 1 ? "member" : "members"}
                    </span>
                    <span>Edited {timeAgo(p.updatedAt)}</span>
                  </footer>
                </article>
              ))}
              <button
                className="new-project-card"
                onClick={() => setCreate(true)}
              >
                <Plus size={28} />
                <span>Create a new project</span>
              </button>
            </div>
          )}
          <div className="dashboard-tip">
            <Code2 size={20} />
            <span>
              Built for working together. Invite a teammate from any project’s
              Members panel.
            </span>
          </div>
        </section>
      </main>
      {create && (
        <Modal title="Create a project" onClose={() => setCreate(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const p = await api<{ id: string }>(
                  "/projects",
                  "POST",
                  Object.fromEntries(new FormData(e.currentTarget)),
                );
                navigate(`/workspace/${p.id}`);
              } catch (e) {
                toast((e as Error).message, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Project name
              <input
                name="name"
                required
                maxLength={80}
                placeholder="My next great idea"
                autoFocus
              />
            </label>
            <label>
              Description
              <textarea
                name="description"
                maxLength={500}
                placeholder="What are you building?"
              />
            </label>
            <label>
              Starting template
              <select name="template">
                <option value="python">Python</option>
                <option value="c">C</option>
                <option value="cpp">C++</option>
                <option value="java">Java</option>
                <option value="go">Go</option>
                <option value="rust">Rust</option>
                <option value="vanilla">HTML, CSS & JavaScript</option>
                <option value="react">React</option>
                <option value="javascript">JavaScript</option>
                <option value="typescript">TypeScript</option>
              </select>
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setCreate(false)}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "Creating…" : "Create project"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
