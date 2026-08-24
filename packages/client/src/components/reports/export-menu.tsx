"use client";

import * as React from "react";
import { Download, FileSpreadsheet, Loader2, Printer } from "lucide-react";
import type { ReportFilters, ReportGroupBy } from "@starter/shared";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/sonner";
import { trpc } from "@/lib/trpc";

export type ExportReportKind = "summary" | "detailed" | "weekly";

export type ExportMenuProps = {
  report: ExportReportKind;
  filters: ReportFilters;
  /** Required by the server for `report === "summary"`. */
  groupBy?: ReportGroupBy;
  /** Required by the server for `report === "weekly"`. */
  weekStart?: string;
  /** Builds and prints the paper view. Supplied by each report screen. */
  onPrint: () => void;
  disabled?: boolean;
};

/** Hand a generated CSV to the browser as a download. */
const downloadCsv = (filename: string, csv: string): void => {
  // The BOM keeps Excel from mangling non-ASCII project names.
  const blob = new Blob([`\uFEFF${csv}`], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoking synchronously can race Safari's download start.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

/**
 * CSV + print export, shared by all three report screens. The CSV is rendered
 * server-side (`reports.exportCsv`) so the file always covers the whole
 * filtered range, not just the page currently on screen.
 */
export function ExportMenu({
  report,
  filters,
  groupBy,
  weekStart,
  onPrint,
  disabled = false,
}: ExportMenuProps): React.JSX.Element {
  const utils = trpc.useUtils();
  const [pending, setPending] = React.useState(false);

  const handleCsv = React.useCallback((): void => {
    setPending(true);
    void (async () => {
      try {
        const result = await utils.reports.exportCsv.fetch({
          ...filters,
          report,
          ...(groupBy ? { groupBy } : {}),
          ...(weekStart ? { weekStart } : {}),
        });
        downloadCsv(result.filename, result.csv);
        toast.success(`Exported ${result.filename}`);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not export the report"
        );
      } finally {
        setPending(false);
      }
    })();
  }, [filters, groupBy, report, utils, weekStart]);

  const handlePrint = React.useCallback((): void => {
    try {
      onPrint();
    } catch {
      toast.error("Could not open the print view");
    }
  }, [onPrint]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || pending}
          data-testid="report-export"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-testid="report-export-menu">
        <DropdownMenuLabel>Export report</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={handleCsv}
          data-testid="report-export-csv"
        >
          <FileSpreadsheet className="size-4" />
          Download CSV
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={handlePrint}
          data-testid="report-export-print"
        >
          <Printer className="size-4" />
          Print / PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
