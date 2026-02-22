"use client";

import Link from "next/link";

export default function WorkbenchPage() {
  return (
    <main className="page-shell">
      <div className="panel card" style={{ maxWidth: 760 }}>
        <h1 style={{ marginTop: 0 }}>API Workbench (Legacy Route)</h1>
        <p className="muted">
          The frontend now has production pages for onboarding, dashboard, chat, reviews, and settings. This route is
          kept so older links do not 404.
        </p>
        <div className="row gap wrap" style={{ marginTop: 12 }}>
          <Link className="btn btn-primary" href="/dashboard">
            Dashboard
          </Link>
          <Link className="btn btn-soft" href="/chat">
            Chat Coach
          </Link>
          <Link className="btn btn-outline" href="/">
            Landing Page
          </Link>
        </div>
      </div>
    </main>
  );
}
