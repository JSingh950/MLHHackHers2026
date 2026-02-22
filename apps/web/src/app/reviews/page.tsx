"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ReviewsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard");
  }, [router]);

  return (
    <main className="page-shell">
      <div className="panel card">Redirecting to dashboard...</div>
    </main>
  );
}
