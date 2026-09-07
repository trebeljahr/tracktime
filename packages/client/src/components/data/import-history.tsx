"use client";

import * as React from "react";
import { Loader2, Undo2 } from "lucide-react";
import { formatDurationShort, type ImportBatchSummary } from "@starter/shared";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { ORIGIN_ID } from "@/hooks/use-sync";
import { trpc } from "@/lib/trpc";

const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

/**
 * Undoing an import is a bulk delete, so it asks first — and it asks the one
 * question the user cannot answer from the row: whether the projects and tags
 * the file invented should go with the entries.
 */
function UndoDialog(props: {
  batch: ImportBatchSummary | null;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const { batch, onOpenChange } = props;
  const utils = trpc.useUtils();
  const [includeCatalog, setIncludeCatalog] = React.useState(true);

  const undo = trpc.data.undo.useMutation({
    onSuccess: (result) => {
      toast.success(
        `Removed ${result.entriesDeleted} imported entries${
          result.projectsDeleted > 0
            ? ` and ${result.projectsDeleted} projects`
            : ""
        }.`,
      );
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(error.message || "Could not undo that import");
    },
    onSettled: () => {
      void utils.entries.invalidate();
      void utils.reports.invalidate();
      void utils.clients.invalidate();
      void utils.projects.invalidate();
      void utils.tasks.invalidate();
      void utils.tags.invalidate();
      void utils.data.history.invalidate();
    },
  });

  return (
    <Dialog open={batch !== null} onOpenChange={onOpenChange}>
      <DialogContent data-testid="import-undo-dialog">
        <DialogHeader>
          <DialogTitle>Undo this import?</DialogTitle>
          <DialogDescription>
            {batch
              ? `${batch.entriesCreated} entries from ${batch.filename ?? "that file"} will be deleted. Time you tracked by hand is never touched.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <label className="flex items-center justify-between gap-4 text-sm">
          <span>
            Also remove what it created
            <span className="block text-xs text-muted-foreground">
              Projects, clients, tasks and tags go only if nothing else uses
              them.
            </span>
          </span>
          <Switch
            checked={includeCatalog}
            onCheckedChange={setIncludeCatalog}
            data-testid="import-undo-catalog"
          />
        </label>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Keep it
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={undo.isPending || !batch}
            onClick={() => {
              if (!batch) return;
              undo.mutate({
                batchId: batch.batchId,
                includeCatalog,
                originId: ORIGIN_ID,
              });
            }}
            data-testid="import-undo-confirm"
          >
            {undo.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Undo2 className="size-4" />
            )}
            Undo import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Past imports, so a mapping mistake found next week is still reversible. */
export function ImportHistory(): React.JSX.Element | null {
  const query = trpc.data.history.useQuery({});
  const [undoing, setUndoing] = React.useState<ImportBatchSummary | null>(null);

  if (query.isPending) {
    return <Skeleton className="h-32 w-full" />;
  }
  // Nothing imported yet is not a state worth a card of its own.
  if (!query.data || query.data.length === 0) return null;

  return (
    <Card data-testid="import-history">
      <CardHeader>
        <CardTitle>Past imports</CardTitle>
        <CardDescription>
          Each import can be rolled back as a unit, however long ago it ran.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Imported</TableHead>
                <TableHead className="text-right">Entries</TableHead>
                <TableHead className="text-right">Time</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.map((batch) => (
                <TableRow key={batch.batchId}>
                  <TableCell className="max-w-56 truncate font-medium">
                    {batch.filename ?? "Unnamed file"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {shortDate(batch.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    {batch.entriesCreated}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatDurationShort(batch.totalSec)}
                  </TableCell>
                  <TableCell className="text-right">
                    {batch.undoneAt ? (
                      <Badge variant="secondary">Undone</Badge>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setUndoing(batch)}
                        data-testid={`import-undo-${batch.batchId}`}
                      >
                        <Undo2 className="size-4" />
                        Undo
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <UndoDialog
        batch={undoing}
        onOpenChange={(open) => {
          if (!open) setUndoing(null);
        }}
      />
    </Card>
  );
}
