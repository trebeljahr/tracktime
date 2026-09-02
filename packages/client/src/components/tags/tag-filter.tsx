"use client";

import * as React from "react";

import {
  MultiSelect,
  type MultiSelectOption,
} from "@/components/reports/multi-select";
import { pickableTags } from "@/components/tags/tag-picker";
import { useTags } from "@/components/tags/use-tags";

export type TagFilterProps = {
  /** Selected tag ids; empty means "no tag filter", not "untagged only". */
  value: string[];
  onChange: (ids: string[]) => void;
  className?: string;
  testId?: string;
};

/**
 * Filters BY tag in the reports filter bar — the read-side counterpart of
 * `TagPicker`. Selecting several tags is an OR ("entries carrying any of
 * these"), matching `ReportFilters.tagIds` on the server.
 */
export function TagFilter({
  value,
  onChange,
  className = "w-[9.5rem]",
  testId = "filter-tags",
}: TagFilterProps): React.JSX.Element {
  const { allTags } = useTags({ includeArchived: true });

  // An archived tag still labels historical time, so it has to stay filterable
  // once it is part of the URL — otherwise a shared report link silently drops
  // its own filter. Archived tags that are NOT selected stay out of the list.
  const options = React.useMemo<MultiSelectOption[]>(
    () =>
      pickableTags(allTags, value).map((tag) => ({
        value: tag.id,
        label: tag.name,
        color: tag.color,
      })),
    [allTags, value],
  );

  return (
    <MultiSelect
      label="Tags"
      options={options}
      value={value}
      onChange={onChange}
      emptyText="No tags yet."
      searchPlaceholder="Search tags..."
      className={className}
      testId={testId}
    />
  );
}
