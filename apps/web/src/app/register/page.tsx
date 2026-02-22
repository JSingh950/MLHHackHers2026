"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/onboarding");
  }, [router]);

  return (
    <main className="page-shell">
      <div className="panel card">Redirecting to conversational onboarding...</div>
    </main>
  );
}
