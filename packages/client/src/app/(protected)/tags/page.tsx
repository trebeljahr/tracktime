"use client";

import * as React from "react";

import { TagManager } from "@/components/tags/tag-manager";

export default function TagsPage(): React.JSX.Element {
  return (
    <div className="space-y-6" data-testid="tags-page">
      <header>
        <h1 className="text-2xl font-bold">Tags</h1>
        <p className="text-sm text-muted-foreground">
          Labels that cut across the project tree. An entry can carry several,
          and archiving one keeps it on the time already tagged with it.
        </p>
      </header>
      <TagManager />
    </div>
  );
}
