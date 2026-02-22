"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "../../lib/api";
import { useAuth } from "../../components/auth-provider";

export default function LoginPage() {
  const router = useRouter();
  const { hydrated, isAuthenticated, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (hydrated && isAuthenticated) {
      router.replace("/dashboard");
    }
  }, [hydrated, isAuthenticated, router]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login({ email, password });
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="panel auth-card">
        <section className="auth-pane auth-accent">
          <div className="brand-pill">Goal Coach</div>
          <h1 className="page-title" style={{ marginTop: 14 }}>Welcome back</h1>
          <p className="muted">
            Sign in to access your today dashboard, chat coach, weekly reviews, and call scheduling settings.
          </p>
          <ul className="list-plain">
            <li>Chat and call memory stay synced through the backend context pack.</li>
            <li>Daily dashboard pulls the same source of truth used by the phone agent tools.</li>
            <li>Weekly reviews keep plan changes pending until you approve them.</li>
          </ul>
        </section>

        <section className="auth-pane">
          <h2 style={{ marginTop: 0 }}>Sign in</h2>
          {error ? <div className="toast error">{error}</div> : null}
          <form onSubmit={onSubmit} className="stack" style={{ marginTop: 12 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="email">Email</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={submitting}>
              {submitting ? "Signing in..." : "Sign in"}
            </button>
          </form>
          <p className="muted compact" style={{ marginBottom: 0 }}>
            New here? <Link href="/register" className="link-btn">Create an account</Link>
          </p>
        </section>
      </div>
    </main>
  );
}
