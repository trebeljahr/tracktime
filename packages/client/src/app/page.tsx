"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * "/" is not a screen — the tracker is the app's home. Redirecting on the
 * client (rather than with `redirect()`) keeps the static export valid.
 */
export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/track");
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground">Loading…</p>
    </div>
  );
}
