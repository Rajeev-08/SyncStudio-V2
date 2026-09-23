import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  Component,
  type ErrorInfo,
} from "react";
import { X, Code2, Check, AlertCircle } from "lucide-react";
const ToastContext = createContext<(message: string, error?: boolean) => void>(
  () => undefined,
);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <ToastContext.Provider
      value={(message, error = false) => setToast({ message, error })}
    >
      {children}
      {toast && (
        <div role="status" className={`toast ${toast.error ? "error" : ""}`}>
          {toast.error ? <AlertCircle size={18} /> : <Check size={18} />}
          <span>{toast.message}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);
export function Logo() {
  return (
    <span className="logo">
      <span className="logo-mark">
        <Code2 size={22} />
      </span>
      SyncStudio
    </span>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "modal wide" : "modal"}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Avatar({
  name,
  color,
  size = "normal",
}: {
  name: string;
  color?: string;
  size?: string;
}) {
  return (
    <span
      title={name}
      className={`avatar ${size}`}
      style={
        color
          ? { background: color + "25", color, borderColor: color + "50" }
          : {}
      }
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <Code2 size={32} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}
export function timeAgo(value: string) {
  const s = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  return s < 60
    ? "just now"
    : s < 3600
      ? `${Math.floor(s / 60)}m ago`
      : s < 86400
        ? `${Math.floor(s / 3600)}h ago`
        : new Date(value).toLocaleDateString();
}
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }
  render() {
    if (this.state.error)
      return (
        <div className="fatal">
          <h1>Something went wrong</h1>
          <p>Your saved work is safe. Reload to reopen the workspace.</p>
          <button onClick={() => location.reload()}>Reload</button>
        </div>
      );
    return this.props.children;
  }
}
