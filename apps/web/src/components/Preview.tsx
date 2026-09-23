import { useEffect, useRef, useState } from "react";
import {
  RefreshCw,
  Monitor,
  Tablet,
  Smartphone,
  ExternalLink,
  Play,
  Pause,
  Trash2,
  Terminal,
  X,
} from "lucide-react";
import type { FileNode } from "../../../../packages/shared/src/index";
import { buildPreview } from "../lib/preview";
export interface ConsoleLine {
  level: string;
  text: string;
  time: string;
}
export function Preview({
  files,
  onClose,
}: {
  files: FileNode[];
  onClose: () => void;
}) {
  const [src, setSrc] = useState(""),
    [auto, setAuto] = useState(true),
    [revision, setRevision] = useState(0),
    [width, setWidth] = useState("100%"),
    [error, setError] = useState(""),
    [logs, setLogs] = useState<ConsoleLine[]>([]),
    [consoleOpen, setConsoleOpen] = useState(true),
    [entry, setEntry] = useState(
      files.find((f) => f.path === "index.html")?.path ??
        files.find((f) => f.path.endsWith(".html"))?.path ??
        "",
    );
  const iframe = useRef<HTMLIFrameElement>(null),
    channel = useRef(
      Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join(""),
    ),
    latest = useRef(files);
  latest.current = files;
  const fileKey = auto ? files.map((f) => f.content).join("\u0000") : "";
  useEffect(() => {
    let canceled = false;
    const timer = setTimeout(() => {
      void buildPreview(latest.current, entry, channel.current)
        .then((html) => {
          if (!canceled) {
            setSrc(html);
            setError("");
          }
        })
        .catch((e) => {
          if (!canceled) setError((e as Error).message);
        });
    }, 650);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [fileKey, revision, entry]);
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (
        e.source !== iframe.current?.contentWindow ||
        e.data?.channel !== channel.current ||
        !["log", "warn", "error"].includes(e.data.level) ||
        typeof e.data.text !== "string"
      )
        return;
      setLogs((prev) => [
        ...prev.slice(-199),
        {
          level: e.data.level,
          text: e.data.text.slice(0, 4000),
          time: new Date().toLocaleTimeString(),
        },
      ]);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);
  return (
    <section className="preview-pane">
      <div className="panel-header">
        <span>
          <Play size={14} />
          Preview
        </span>
        <div className="actions">
          <button
            title={auto ? "Pause auto-refresh" : "Enable auto-refresh"}
            onClick={() => setAuto(!auto)}
          >
            {auto ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button
            aria-label="Refresh preview"
            title="Refresh preview"
            onClick={() => setRevision((v) => v + 1)}
          >
            <RefreshCw size={15} />
          </button>
          <button
            title="Open preview in expanded view"
            onClick={() => iframe.current?.requestFullscreen()}
          >
            <ExternalLink size={15} />
          </button>
          <button aria-label="Close preview" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
      </div>
      <div className="preview-toolbar">
        <select
          aria-label="Preview entry"
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
        >
          {files
            .filter((f) => f.path.endsWith(".html"))
            .map((f) => (
              <option key={f.id} value={f.path}>
                {f.path}
              </option>
            ))}
        </select>
        <div className="actions">
          {[
            { w: "100%", icon: Monitor, label: "Desktop" },
            { w: "768px", icon: Tablet, label: "Tablet" },
            { w: "375px", icon: Smartphone, label: "Mobile" },
          ].map(({ w, icon: Icon, label }) => (
            <button
              key={w}
              title={label}
              aria-label={label + " preview"}
              className={width === w ? "selected" : ""}
              onClick={() => setWidth(w)}
            >
              <Icon size={15} />
            </button>
          ))}
        </div>
      </div>
      {error && (
        <div role="alert" className="preview-error">
          {error}
        </div>
      )}
      <div className="preview-stage">
        <iframe
          ref={iframe}
          title="Project preview"
          sandbox="allow-scripts"
          allow="fullscreen"
          srcDoc={src}
          style={{ width, maxWidth: "100%" }}
        />
      </div>
      <div className="console-header">
        <button onClick={() => setConsoleOpen(!consoleOpen)}>
          <Terminal size={14} />
          Console <span className="count">{logs.length}</span>
        </button>
        <button aria-label="Clear console" onClick={() => setLogs([])}>
          <Trash2 size={14} />
        </button>
      </div>
      {consoleOpen && (
        <div className="console-output" role="log">
          {logs.length === 0 ? (
            <span className="muted">Runtime messages appear here.</span>
          ) : (
            logs.map((l, i) => (
              <div key={i} className={"console-line " + l.level}>
                <span>{l.time}</span>
                <code>{l.text}</code>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
