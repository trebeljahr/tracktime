import * as React from "react";

import { BrandLockup } from "@/components/brand-lockup";

/**
 * The heading block every unauthenticated page shares.
 *
 * These four pages are the only ones rendered outside the app shell, so they
 * are also the only ones with nothing on screen to say which app is asking
 * for a password — which matters most on exactly the page where a person
 * should be checking that before they type one.
 */
export function AuthHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col items-center text-center">
      <BrandLockup className="mb-8" />
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}
