"use client";

import * as React from "react";
import {
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Pencil,
  Plus,
  Tags,
  Trash2,
} from "lucide-react";

import { ColorPicker, COLOR_PALETTE } from "@/components/color-picker";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/catalog/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/sonner";
import { useFormatSettings } from "@/lib/format";
import {
  useTagMutations,
  useTags,
  type TagRow,
} from "@/components/tags/use-tags";

const FALLBACK_COLOR = "#8b5cf6";

/**
 * What deleting this tag will actually do.
 *
 * The server refuses to hard-delete a tag that still labels tracked time and
 * archives it instead, so the dialog says which of the two is about to happen
 * rather than promising a deletion it may not get.
 */
export function removalPreview(tag: TagRow): {
  title: string;
  confirmLabel: string;
  description: string;
} {
  if (tag.entryCount > 0) {
    const plural = tag.entryCount === 1 ? "entry" : "entries";
    return {
      title: `Archive "${tag.name}"?`,
      confirmLabel: "Archive",
      description:
        `${tag.entryCount} time ${plural} still carry this tag, so it will be ` +
        "archived rather than deleted — the time keeps its label, and the tag " +
        "stops being offered on new entries.",
    };
  }
  return {
    title: `Delete "${tag.name}"?`,
    confirmLabel: "Delete",
    description:
      "Nothing is tagged with it, so it will be deleted outright. This cannot " +
      "be undone.",
  };
}

/** Tag management surface — create, rename, recolour, archive, delete. */
export function TagManager(): React.JSX.Element {
  const format = useFormatSettings();
  const { allTags, isLoading } = useTags({ includeArchived: true });
  const { setTagArchived, removeTag } = useTagMutations();

  const [showArchived, setShowArchived] = React.useState(false);
  const [editing, setEditing] = React.useState<TagRow | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<TagRow | null>(null);

  const rows = React.useMemo(
    () => (showArchived ? allTags : allTags.filter((tag) => !tag.archived)),
    [allTags, showArchived],
  );

  const archivedCount = allTags.filter((tag) => tag.archived).length;

  return (
    <div className="space-y-4" data-testid="tag-manager">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => setCreating(true)} data-testid="new-tag">
          <Plus className="size-4" />
          New tag
        </Button>

        {archivedCount > 0 ? (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch
              checked={showArchived}
              onCheckedChange={setShowArchived}
              data-testid="tags-show-archived"
            />
            Show archived ({archivedCount})
          </label>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-2" data-testid="tags-loading">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Tags}
          title="No tags yet"
          description="Tags cut across projects — “on-site”, “bugfix”, “needs review”. Add one here, or coin it straight from the tracker bar."
          action={
            <Button onClick={() => setCreating(true)} data-testid="tags-empty-create">
              <Plus className="size-4" />
              New tag
            </Button>
          }
          testId="tags-empty"
        />
      ) : (
        <div className="rounded-lg border border-border">
          <Table data-testid="tags-table">
            <TableHeader>
              <TableRow>
                <TableHead>Tag</TableHead>
                <TableHead className="text-right">Entries</TableHead>
                <TableHead className="text-right">Tracked</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((tag) => (
                <TableRow
                  key={tag.id}
                  data-testid={`tag-row-${tag.id}`}
                  data-archived={tag.archived ? "true" : "false"}
                >
                  <TableCell>
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span
                        className="truncate font-medium"
                        data-testid={`tag-name-${tag.id}`}
                      >
                        {tag.name}
                      </span>
                      {tag.archived ? (
                        <Badge variant="outline" className="shrink-0">
                          Archived
                        </Badge>
                      ) : null}
                    </span>
                  </TableCell>

                  <TableCell
                    className="text-right tabular-nums text-muted-foreground"
                    data-testid={`tag-entries-${tag.id}`}
                  >
                    {tag.entryCount}
                  </TableCell>

                  <TableCell
                    className="text-right tabular-nums"
                    data-testid={`tag-tracked-${tag.id}`}
                  >
                    {format.duration(tag.totalSec)}
                  </TableCell>

                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`Actions for ${tag.name}`}
                          data-testid={`tag-menu-${tag.id}`}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => setEditing(tag)}
                          data-testid={`tag-edit-${tag.id}`}
                        >
                          <Pencil className="size-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => setTagArchived(tag.id, !tag.archived)}
                          data-testid={`tag-archive-${tag.id}`}
                        >
                          {tag.archived ? (
                            <ArchiveRestore className="size-4" />
                          ) : (
                            <Archive className="size-4" />
                          )}
                          {tag.archived ? "Unarchive" : "Archive"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setPendingDelete(tag)}
                          data-testid={`tag-delete-${tag.id}`}
                        >
                          <Trash2 className="size-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <TagFormDialog
        open={creating || editing !== null}
        onOpenChange={(next) => {
          if (!next) {
            setCreating(false);
            setEditing(null);
          }
        }}
        tag={editing}
      />

      {pendingDelete ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setPendingDelete(null);
          }}
          title={removalPreview(pendingDelete).title}
          description={removalPreview(pendingDelete).description}
          confirmLabel={removalPreview(pendingDelete).confirmLabel}
          onConfirm={() => removeTag(pendingDelete.id)}
          testId="tag-confirm-delete"
        />
      ) : null}
    </div>
  );
}

// ── create / edit form ───────────────────────────────────────────────

export type TagFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omitted/null creates; otherwise the dialog edits this tag. */
  tag?: TagRow | null;
};

export function TagFormDialog({
  open,
  onOpenChange,
  tag,
}: TagFormDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="tag-dialog">
        {open ? (
          <TagForm
            key={tag?.id ?? "new"}
            tag={tag ?? null}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

type TagFormProps = {
  tag: TagRow | null;
  onDone: () => void;
};

function TagForm({ tag, onDone }: TagFormProps): React.JSX.Element {
  const [name, setName] = React.useState(tag?.name ?? "");
  const [color, setColor] = React.useState(
    tag?.color ?? COLOR_PALETTE[10] ?? FALLBACK_COLOR,
  );
  const [nameError, setNameError] = React.useState<string | null>(null);

  const { createTag, updateTag, isSaving } = useTagMutations({
    onConflict: setNameError,
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setNameError(null);

    const trimmed = name.trim();
    if (trimmed === "") {
      setNameError("Name is required");
      return;
    }

    if (tag) {
      void updateTag({ id: tag.id, name: trimmed, color }).then((saved) => {
        if (!saved) return;
        toast.success("Tag saved.");
        onDone();
      });
      return;
    }

    void createTag({ name: trimmed, color }).then((created) => {
      if (!created) return;
      toast.success(`Tag "${created.name}" created.`);
      onDone();
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{tag ? "Edit tag" : "New tag"}</DialogTitle>
        <DialogDescription>
          A label that cuts across projects. One entry can carry several.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <Label htmlFor="tag-name">Name</Label>
        <div className="flex items-center gap-2">
          <ColorPicker value={color} onChange={setColor} testId="tag-color" />
          <Input
            id="tag-name"
            value={name}
            autoFocus
            maxLength={60}
            placeholder="needs review"
            aria-invalid={nameError !== null}
            onChange={(event) => {
              setName(event.target.value);
              if (nameError) setNameError(null);
            }}
            data-testid="tag-name-input"
          />
        </div>
        {nameError ? (
          <p className="text-sm text-destructive" data-testid="tag-name-error">
            {nameError}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onDone}
          data-testid="tag-cancel"
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSaving} data-testid="tag-submit">
          {tag ? "Save" : "Create"}
        </Button>
      </DialogFooter>
    </form>
  );
}
