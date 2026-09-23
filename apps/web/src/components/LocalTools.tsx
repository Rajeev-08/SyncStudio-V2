import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { io, type Socket } from "socket.io-client";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  Play,
  Square,
  Terminal as TerminalIcon,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Trash2,
} from "lucide-react";
import { api } from "../lib/api";
import type {
  FileNode,
  Workspace,
  Reply,
} from "../../../../packages/shared/src/index";
interface LocalStatus {
  enabled: boolean;
  authorized: boolean;
  pty: boolean;
  platform: string;
  shell: string;
  reason: string;
  tools: Record<string, { command: string; version: string } | null>;
}
export function LocalTools({
  project,
  file,
  saveAll,
  runSignal,
  terminalSignal,
}: {
  project: Workspace;
  file?: FileNode;
  saveAll: () => Promise<void>;
  runSignal: number;
  terminalSignal: number;
}) {
  const [tab, setTab] = useState("output"),
    [open, setOpen] = useState(true),
    [error, setError] = useState(""),
    [output, setOutput] = useState(
      "Select a source file and click Run file.\n",
    ),
    [running, setRunning] = useState(false),
    [starting, setStarting] = useState(false),
    [connected, setConnected] = useState(false),
    [terminalOpen, setTerminalOpen] = useState(false),
    [input, setInput] = useState(""),
    [cwd, setCwd] = useState("");
  const host = useRef<HTMLDivElement>(null),
    term = useRef<Terminal | null>(null),
    fit = useRef<FitAddon | null>(null),
    socket = useRef<Socket | null>(null),
    outputElement = useRef<HTMLPreElement>(null);
  const state = useQuery({
    queryKey: ["local-status"],
    queryFn: () => api<LocalStatus>("/local/status"),
  });
  const authorized = state.data?.authorized && project.role === "OWNER";
  const ext = file?.path.split(".").pop()?.toLowerCase();
  const selected = (
    {
      py: "python",
      c: "c",
      cpp: "cpp",
      cc: "cpp",
      java: "java",
      js: "javascript",
      mjs: "javascript",
      cjs: "javascript",
      ts: "typescript",
      go: "go",
      rs: "rust",
    } as Record<string, string>
  )[ext ?? ""];
  useEffect(() => {
    if (!authorized) return;
    const s = io("/local-tools", {
      transports: ["websocket"],
      auth: { projectId: project.id },
      reconnection: false,
    });
    socket.current = s;
    s.on("connect", () => setConnected(true));
    s.on("connect_error", (e) => setError(e.message));
    s.on("disconnect", () => {
      setConnected(false);
      setRunning(false);
      setStarting(false);
      setTerminalOpen(false);
      term.current?.writeln(
        "\r\n[Disconnected. Reopen the project to reconnect.]",
      );
    });
    s.on("local:error", setError);
    s.on("run:data", (data: string) =>
      setOutput((o) => (o + data).slice(-200000)),
    );
    s.on(
      "run:state",
      (data: {
        running: boolean;
        cwd?: string;
        exitCode?: number;
        stopped?: boolean;
      }) => {
        setRunning(data.running);
        if (data.cwd) setCwd(data.cwd);
        if (!data.running)
          setOutput(
            (o) =>
              o +
              `\n[${data.stopped ? "Stopped" : "Exit code " + data.exitCode}]\n`,
          );
      },
    );
    s.on("terminal:data", (data: string) => term.current?.write(data));
    s.on("terminal:exit", (data: { exitCode: number }) => {
      setTerminalOpen(false);
      term.current?.writeln(`\r\n[Shell exited: ${data.exitCode}]`);
    });
    return () => {
      s.disconnect();
      socket.current = null;
    };
  }, [authorized, project.id]);
  useEffect(() => {
    if (!host.current) return;
    const t = new Terminal({
      fontFamily: "Consolas, monospace",
      fontSize: 13,
      scrollback: 2000,
      cursorBlink: true,
      theme: { background: "#11131b", foreground: "#ededf5" },
      allowProposedApi: false,
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(host.current);
    term.current = t;
    fit.current = f;
    const data = t.onData((value) =>
      socket.current?.emit("terminal:input", { data: value }),
    );
    const resize = () => {
      if (host.current?.offsetWidth) {
        f.fit();
        socket.current?.emit("terminal:resize", {
          cols: Math.max(20, t.cols),
          rows: Math.max(5, t.rows),
        });
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    resize();
    return () => {
      observer.disconnect();
      data.dispose();
      t.dispose();
      term.current = null;
    };
  }, []);
  useEffect(() => {
    if (open && tab === "terminal")
      requestAnimationFrame(() => fit.current?.fit());
  }, [open, tab]);
  useEffect(() => {
    if (outputElement.current)
      outputElement.current.scrollTop = outputElement.current.scrollHeight;
  }, [output]);
  async function request<T>(event: string, data: unknown): Promise<T> {
    const s = socket.current;
    if (!s?.connected)
      throw new Error(
        "Local tools are not connected. Check setup and reopen this project.",
      );
    return new Promise((resolve, reject) =>
      s.timeout(15000).emit(event, data, (e: Error | null, r: Reply<T>) => {
        if (e) reject(new Error("Local operation timed out."));
        else if (!r.ok)
          reject(new Error(r.error?.message ?? "Local operation failed"));
        else resolve(r.data as T);
      }),
    );
  }
  async function run() {
    setOpen(true);
    setTab("output");
    setError("");
    setStarting(true);
    try {
      await saveAll();
      setOutput("");
      await request("run:start", { fileId: file?.id, epoch: project.epoch });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }
  useEffect(() => {
    if (terminalSignal > 0) {
      setOpen(true);
      setTab("terminal");
    }
  }, [terminalSignal]);
  const runCallback = useRef(run);
  runCallback.current = run;
  useEffect(() => {
    if (runSignal > 0) void runCallback.current();
  }, [runSignal]);
  async function shell() {
    setOpen(true);
    setTab("terminal");
    setStarting(true);
    setError("");
    try {
      await saveAll();
      fit.current?.fit();
      const r = await request<{ cwd: string }>("terminal:open", {
        cols: Math.max(20, term.current?.cols ?? 80),
        rows: Math.max(5, term.current?.rows ?? 18),
      });
      setCwd(r.cwd);
      setTerminalOpen(true);
      term.current?.focus();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }
  return (
    <section
      className={`local-tools ${open ? "" : "collapsed"}`}
      aria-label="Terminal and language tools"
    >
      <header>
        <div role="tablist" aria-label="Local tool panels">
          {["output", "terminal", "languages"].map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={tab === t ? "active" : ""}
              onClick={() => {
                setTab(t);
                setOpen(true);
              }}
            >
              {t === "terminal" && <TerminalIcon size={14} />}{" "}
              {t === "languages"
                ? "Languages"
                : t === "output"
                  ? "Output"
                  : "Terminal"}
            </button>
          ))}
        </div>
        <div className="local-actions">
          <button
            disabled={
              !authorized ||
              !connected ||
              !selected ||
              !state.data?.tools[selected] ||
              running ||
              starting
            }
            onClick={() => void run()}
            title={
              selected ? `Run ${file?.path}` : "Select a supported source file"
            }
          >
            <Play size={14} />
            Run file
          </button>
          <button
            disabled={!running}
            onClick={() =>
              void request("run:stop", {}).catch((e) => setError(e.message))
            }
          >
            <Square size={13} />
            Stop
          </button>
          <button
            aria-label={
              open ? "Collapse terminal panel" : "Expand terminal panel"
            }
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          </button>
        </div>
      </header>
      <div hidden={!open}>
        {(error || state.error) && (
          <div role="alert" className="local-error">
            {error || state.error?.message}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        {!authorized && !state.isLoading && (
          <div className="local-setup">
            <strong>Local tools setup</strong>
            <p>
              {project.role !== "OWNER"
                ? "Local code execution is available only to the project owner on their own computer."
                : state.data?.reason}
            </p>
            <code>npm run local:setup</code>
            <span>
              {" "}
              Then restart <code>npm run dev</code> and sign in with the email
              you configured.
            </span>
          </div>
        )}
        <div hidden={tab !== "output"} className="local-output-panel">
          <div className="local-subbar">
            <span>
              {running
                ? "Running"
                : starting
                  ? "Preparing saved files…"
                  : selected
                    ? `${selected} · ${file?.path}`
                    : "Select a Python, C, C++, Java, JS, TS, Go, or Rust file"}
            </span>
            <button aria-label="Clear output" onClick={() => setOutput("")}>
              <Trash2 size={13} />
            </button>
          </div>
          <pre ref={outputElement} aria-label="Program output" tabIndex={0}>
            {output}
          </pre>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void request("run:input", { data: input + "\n" })
                .then(() => setInput(""))
                .catch((e) => setError(e.message));
            }}
          >
            <input
              aria-label="Program input"
              placeholder="Input for your running program…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={!running}
            />
            <button disabled={!running}>Send input</button>
          </form>
        </div>
        <div hidden={tab !== "terminal"}>
          <div className="local-subbar">
            <span>{state.data?.shell ?? "Shell"} · saved project copy</span>
            <button
              disabled={
                !authorized ||
                !connected ||
                !state.data?.pty ||
                starting ||
                terminalOpen ||
                running
              }
              onClick={() => void shell()}
            >
              Open terminal
            </button>
            <button
              disabled={!terminalOpen}
              onClick={() =>
                void request("terminal:close", {}).catch((e) =>
                  setError(e.message),
                )
              }
            >
              Close shell
            </button>
          </div>
          {authorized && state.data && !state.data.pty && (
            <p className="local-error">
              Native terminal support is missing. Run{" "}
              <code>npm install node-pty</code>, then restart. Run file is
              available independently.
            </p>
          )}
          <div className="local-terminal-host" ref={host} />
        </div>
        <div hidden={tab !== "languages"} className="local-languages">
          <div className="local-subbar">
            <span>Installed on the computer running SyncStudio</span>
            <button onClick={() => void state.refetch()}>
              <RefreshCw size={13} />
              Refresh
            </button>
          </div>
          {[
            "javascript",
            "typescript",
            "python",
            "c",
            "cpp",
            "java",
            "go",
            "rust",
          ].map((l) => (
            <div key={l}>
              <strong>
                {
                  (
                    {
                      javascript: "JavaScript",
                      typescript: "TypeScript",
                      python: "Python",
                      c: "C",
                      cpp: "C++",
                      java: "Java",
                      go: "Go",
                      rust: "Rust",
                    } as Record<string, string>
                  )[l]
                }
              </strong>
              <span className={state.data?.tools[l] ? "installed" : "missing"}>
                {!authorized
                  ? "Enable local tools"
                  : state.data?.tools[l]
                    ? "Installed"
                    : "Not installed"}
              </span>
              <small>
                {state.data?.tools[l]?.version ??
                  (
                    {
                      python: "Install Python and add it to PATH.",
                      c: "Install GCC or Clang.",
                      cpp: "Install G++ or Clang++.",
                      java: "Install JDK 17 or newer.",
                      go: "Install Go.",
                      rust: "Install Rust via rustup.",
                    } as Record<string, string>
                  )[l] ??
                  "Uses the Node.js running SyncStudio."}
              </small>
            </div>
          ))}
        </div>
        {cwd && (
          <div className="local-directory" title={cwd}>
            Working copy: {cwd}. Terminal files stay here; Run file uses a fresh
            copy of saved editor files.
          </div>
        )}
      </div>
    </section>
  );
}
