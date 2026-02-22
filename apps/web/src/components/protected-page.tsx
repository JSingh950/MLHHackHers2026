"use client";

import type { ReactNode } from "react";
import { AppShell } from "./app-shell";
import { RequireAuth } from "./require-auth";

export function ProtectedPage({
  title,
  subtitle,
  children
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <RequireAuth>
      <AppShell title={title} subtitle={subtitle}>
        {children}
      </AppShell>
    </RequireAuth>
  );
}
