"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo } from "react";
import { useAuth } from "./auth-provider";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/chat", label: "Chat Coach" },
  { href: "/settings", label: "Settings" }
];

export function AppShell({
  title,
  subtitle,
  children,
  headerRight
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  headerRight?: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, logout } = useAuth();

  const initials = useMemo(() => {
    const name = session?.user.name ?? "User";
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("");
  }, [session?.user.name]);

  return (
    <div className="app-bg">
      <div className="app-frame">
        <aside className="sidebar panel panel-glass">
          <div className="brand-block">
            <div className="brand-pill">Goal Coach</div>
            <p className="muted compact">Coach + calls + memory, synced across chat and check-ins.</p>
          </div>

          <nav className="nav-list" aria-label="Primary">
            {navItems.map((item) => {
              const active = pathname === item.href;
              return (
                <Link key={item.href} href={item.href} className={`nav-item ${active ? "active" : ""}`}>
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="sidebar-footer">
            <div className="user-card">
              <div className="avatar">{initials || "U"}</div>
              <div>
                <div className="user-name">{session?.user.name ?? "Not signed in"}</div>
                <div className="muted compact">{session?.user.email ?? ""}</div>
              </div>
            </div>
            <div className="row gap-sm wrap">
              <button
                className="btn btn-soft"
                type="button"
                onClick={() => router.push(session ? "/dashboard" : "/login")}
              >
                Home
              </button>
              <button
                className="btn btn-danger"
                type="button"
                onClick={() => {
                  void logout().then(() => router.replace("/login"));
                }}
              >
                Logout
              </button>
            </div>
          </div>
        </aside>

        <main className="content">
          <header className="topbar panel panel-glass">
            <div>
              <h1 className="page-title">{title}</h1>
              {subtitle ? <p className="muted">{subtitle}</p> : null}
            </div>
            {headerRight ?? (
              <div className="status-group">
                <div className={`status-dot ${session?.user.phone_verified ? "ok" : "warn"}`} />
                <span className="muted compact">{session?.user.phone_verified ? "Phone verified" : "Phone unverified"}</span>
              </div>
            )}
          </header>
          {children}
        </main>
      </div>
    </div>
  );
}
