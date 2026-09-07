"use client";

import * as React from "react";
import { FileJson, FileSpreadsheet, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "@/components/ui/sonner";
import { canDownloadFiles } from "@/components/reports/export-menu";
import { downloadBlob } from "@/lib/download";
import { trpc } from "@/lib/trpc";

const stamp = (): string => new Date().toISOString().slice(0, 10);

/**
 * Everything out, in one click.
 *
 * Two formats because they answer different questions. The JSON carries the
 * whole workspace — archived catalog entries, colors, project rates, the
 * currency each entry was billed in — and is what this app's own importer
 * reads back losslessly. The CSV carries what a spreadsheet can hold, in the
 * exact column shape the importer recognises, so editing history in a
 * spreadsheet and importing it back is a supported round trip rather than a
 * lucky one.
 */
export function ExportPanel(): React.JSX.Element {
  const utils = trpc.useUtils();
  const [pending, setPending] = React.useState<"json" | "csv" | null>(null);

  const run = React.useCallback(
    (kind: "json" | "csv", task: () => Promise<void>): void => {
      if (!canDownloadFiles()) {
        toast.error(
          "This app can't save files yet — open tracktime in a browser to export.",
        );
        return;
      }
      setPending(kind);
      void (async () => {
        try {
          await task();
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : "Could not export",
          );
        } finally {
          setPending(null);
        }
      })();
    },
    [],
  );

  const exportJson = React.useCallback((): void => {
    run("json", async () => {
      const data = await utils.data.exportJson.fetch({});
      const filename = `tracktime-export-${stamp()}.json`;
      downloadBlob(
        filename,
        new Blob([JSON.stringify(data, null, 2)], {
          type: "application/json",
        }),
      );
      toast.success(`Exported ${data.entries.length} entries.`);
    });
  }, [run, utils]);

  const exportCsv = React.useCallback((): void => {
    run("csv", async () => {
      const result = await utils.data.exportCsv.fetch({});
      downloadBlob(
        result.filename,
        // The server already writes the BOM Excel needs.
        new Blob([result.csv], { type: "text/csv;charset=utf-8;" }),
      );
      toast.success(`Exported ${result.filename}`);
    });
  }, [run, utils]);

  return (
    <Card data-testid="export-panel">
      <CardHeader>
        <CardTitle>Export everything</CardTitle>
        <CardDescription>
          Your whole workspace, in a file you keep. The JSON is a complete
          backup and imports back losslessly; the CSV opens in any spreadsheet
          and this importer reads it back.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={exportJson}
          disabled={pending !== null}
          data-testid="export-json"
        >
          {pending === "json" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <FileJson className="size-4" />
          )}
          Download JSON backup
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={exportCsv}
          disabled={pending !== null}
          data-testid="export-csv"
        >
          {pending === "csv" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <FileSpreadsheet className="size-4" />
          )}
          Download CSV
        </Button>
      </CardContent>
    </Card>
  );
}
