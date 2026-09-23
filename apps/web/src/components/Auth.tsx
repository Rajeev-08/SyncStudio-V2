import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, GitBranch, Users, Terminal } from "lucide-react";
import { api } from "../lib/api";
import type { User } from "../../../../packages/shared/src/index";
import { Logo } from "./UI";
export function Auth({ register = false }: { register?: boolean }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const qc = useQueryClient(),
    navigate = useNavigate();
  const options = useQuery({
    queryKey: ["auth-options"],
    queryFn: () => api<{ demo: boolean }>("/auth/options"),
  });
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Logo />
        <div>
          <span className="eyebrow">YOUR SHARED WORKSPACE</span>
          <h1>
            Great code.
            <br />
            Better together.
          </h1>
          <p>A place for your next idea to become something real.</p>
          <div className="auth-features">
            <span>
              <Terminal size={19} /> A workspace that feels like home
            </span>
            <span>
              <Users size={19} /> Every cursor, in sync
            </span>
            <span>
              <GitBranch size={19} /> Room to experiment. A way back.
            </span>
          </div>
        </div>
        <span className="muted">SyncStudio · Collaborative development</span>
      </section>
      <section className="auth-form">
        <div>
          <h2>{register ? "Create your account" : "Welcome back"}</h2>
          <p className="muted">
            {register
              ? "Make space for your next great idea."
              : "Sign in to your workspace."}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const values = Object.fromEntries(new FormData(e.currentTarget));
              try {
                const u = await api(
                  `/auth/${register ? "register" : "login"}`,
                  "POST",
                  values,
                );
                qc.setQueryData(["me"], u);
                navigate("/");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {register && (
              <label>
                Username
                <input
                  name="username"
                  autoComplete="username"
                  required
                  minLength={2}
                  maxLength={32}
                  pattern="[a-zA-Z0-9_-]+"
                  placeholder="Your name"
                />
              </label>
            )}
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                required
                minLength={10}
                maxLength={128}
                placeholder={
                  register ? "At least 10 characters" : "Your password"
                }
              />
            </label>
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy ? "Please wait…" : register ? "Create account" : "Sign in"}
              <ArrowRight size={16} />
            </button>
          </form>
          {options.data?.demo && (
            <button
              className="full"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const result = await api<{ user: User; projectId: string }>(
                    "/auth/demo",
                    "POST",
                  );
                  qc.setQueryData(["me"], result.user);
                  navigate(`/workspace/${result.projectId}`);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Try a demo workspace
            </button>
          )}
          <p className="auth-switch">
            {register ? "Already have an account?" : "New to SyncStudio?"}{" "}
            <Link to={register ? "/login" : "/register"}>
              {register ? "Sign in" : "Create an account"}
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
