"use client";

import * as React from "react";
import { FileText, Plus } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatDate, statusBadgeTone, type InvoiceRow } from "./types";

export type InvoiceListProps = {
  invoices: InvoiceRow[];
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
};

/**
 * The ledger.
 *
 * Money is formatted with the invoice's OWN snapshotted currency, not the
 * workspace's current one: a document issued in USD stays a USD document
 * after the workspace switches to EUR.
 */
export function InvoiceList({
  invoices,
  isLoading,
  selectedId,
  onSelect,
  onCreate,
}: InvoiceListProps): React.JSX.Element {
  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="invoices-loading">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  if (invoices.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No invoices yet"
        description="An invoice turns one client's billable time over one date range into a document. Time that lands on an invoice is never offered for billing again."
        action={
          <Button onClick={onCreate} data-testid="invoices-empty-create">
            <Plus className="size-4" />
            New invoice
          </Button>
        }
        testId="invoices-empty"
      />
    );
  }

  return (
    <div className="rounded-lg border border-border">
      <Table data-testid="invoices-table">
        <TableHeader>
          <TableRow>
            <TableHead>Number</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Issued</TableHead>
            <TableHead>Due</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((invoice) => (
            <TableRow
              key={invoice.id}
              onClick={() => onSelect(invoice.id)}
              className={cn(
                "cursor-pointer",
                invoice.id === selectedId && "bg-muted/60",
              )}
              data-testid={`invoice-row-${invoice.id}`}
              data-status={invoice.status}
            >
              <TableCell className="font-medium">
                <button
                  type="button"
                  className="underline-offset-2 hover:underline"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(invoice.id);
                  }}
                  data-testid={`invoice-open-${invoice.id}`}
                >
                  {invoice.number}
                </button>
              </TableCell>
              <TableCell data-testid={`invoice-client-${invoice.id}`}>
                {invoice.clientName}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDate(invoice.issueDate)}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDate(invoice.dueDate)}
              </TableCell>
              <TableCell
                className="text-right tabular-nums"
                data-testid={`invoice-total-${invoice.id}`}
              >
                {formatMoney(invoice.total, invoice.currency)}
              </TableCell>
              <TableCell>
                <Badge
                  variant={statusBadgeTone(invoice.status)}
                  data-testid={`invoice-status-${invoice.id}`}
                >
                  {invoice.status}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
