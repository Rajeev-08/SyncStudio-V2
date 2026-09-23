import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import type { User } from "../../../packages/shared/src/index";
import { api, ApiError } from "./lib/api";
import { Auth } from "./components/Auth";
import { Dashboard } from "./components/Dashboard";
const WorkspacePage = lazy(() =>
  import("./components/Workspace").then((m) => ({ default: m.WorkspacePage })),
);
import { ErrorBoundary, ToastProvider } from "./components/UI";
import "./style.css";
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
function App() {
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<User>("/auth/me"),
  });
  if (me.isLoading) return <div className="boot">Opening SyncStudio…</div>;
  if (me.isError && !(me.error instanceof ApiError && me.error.status === 401))
    return (
      <div className="fatal">
        <h2>Cannot reach SyncStudio</h2>
        <p>{me.error.message}</p>
        <button onClick={() => me.refetch()}>Retry</button>
      </div>
    );
  return (
    <Routes>
      <Route path="/login" element={me.data ? <Navigate to="/" /> : <Auth />} />
      <Route
        path="/register"
        element={me.data ? <Navigate to="/" /> : <Auth register />}
      />
      <Route
        path="/"
        element={
          me.data ? <Dashboard user={me.data} /> : <Navigate to="/login" />
        }
      />
      <Route
        path="/workspace/:projectId"
        element={
          me.data ? (
            <Suspense fallback={<div className="boot">Loading editor…</div>}>
              <WorkspacePage user={me.data} />
            </Suspense>
          ) : (
            <Navigate to="/login" />
          )
        }
      />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </ErrorBoundary>,
);
