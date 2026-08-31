"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { getSession } from "@/lib/auth-client";
import { AppShell } from "@/components/app-shell";

type Verdict = "checking" | "in" | "out";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();

  // The session hook is mounted at the root, so a `null` it cached while the
  // user sat on /login or /signup survives the navigation that follows a
  // successful sign-in. Trusting it directly would bounce a freshly
  // authenticated user straight back to /login. Before redirecting anyone,
  // confirm with the server once.
  const [recheck, setRecheck] = React.useState<Verdict>("checking");

  React.useEffect(() => {
    if (isLoading) return;

    if (isAuthenticated) {
      setRecheck("in");
      return;
    }

    let cancelled = false;
    setRecheck("checking");

    void getSession()
      .then((result) => {
        if (cancelled) return;
        setRecheck(result?.data?.session ? "in" : "out");
      })
      .catch(() => {
        // A network failure is not proof of being signed out, but there is
        // nothing useful to render either — send them to /login and let them
        // retry there.
        if (!cancelled) setRecheck("out");
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isLoading]);

  React.useEffect(() => {
    if (recheck === "out") router.replace("/login");
  }, [recheck, router]);

  if (isLoading || recheck === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (recheck === "out") return null;

  return <AppShell>{children}</AppShell>;
}
