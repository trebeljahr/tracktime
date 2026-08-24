"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type EmptyStateProps = {
  /** Lucide icon component, rendered in a muted circle. */
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  /** Primary call to action — usually a `<Button>`. */
  action?: React.ReactNode;
  className?: string;
  testId?: string;
};

/** The "nothing here yet" placeholder every list screen falls back to. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  testId = "empty-state",
}: EmptyStateProps): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center",
        className
      )}
      data-testid={testId}
    >
      {Icon ? (
        <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-5" />
        </span>
      ) : null}
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {description ? (
          <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
