"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./auth-provider";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { hydrated, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (hydrated && !isAuthenticated) {
      router.replace("/login");
    }
  }, [hydrated, isAuthenticated, router]);

  if (!hydrated) {
    return <div className="page-shell"><div className="panel card">Loading session...</div></div>;
  }

  if (!isAuthenticated) {
    return <div className="page-shell"><div className="panel card">Redirecting to login...</div></div>;
  }

  return <>{children}</>;
}
