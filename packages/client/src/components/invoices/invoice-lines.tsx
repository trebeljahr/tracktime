"use client";

import * as React from "react";
import type { InvoiceLineItem } from "@starter/shared";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { formatHours, taxLabel, totalHours } from "./types";

export type InvoiceLinesProps = {
  lineItems: InvoiceLineItem[];
  subtotal: number;
  taxRate: number | null;
  taxAmount: number;
  total: number;
  currency: string;
  /** Prefix for every test id, so preview and detail never collide. */
  testIdPrefix: string;
};

/**
 * Lines and totals — the same table for the preview and for the saved
 * document, because the whole promise of the preview is that it shows exactly
 * what will be persisted. Two renderings that could drift would break that.
 *
 * A group billed at two different rates arrives as two lines from the server;
 * that is intentional and is why the rate column is per-line rather than a
 * single figure in the header.
 */
export function InvoiceLines({
  lineItems,
  subtotal,
  taxRate,
  taxAmount,
  total,
  currency,
  testIdPrefix,
}: InvoiceLinesProps): React.JSX.Element {
  const money = (amount: number): string => formatMoney(amount, currency);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border">
        <Table data-testid={`${testIdPrefix}-lines`}>
          <TableHeader>
            <TableRow>
              <TableHead>Line</TableHead>
              <TableHead className="text-right">Hours</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lineItems.map((line) => (
              <TableRow key={line.key} data-testid={`${testIdPrefix}-line`}>
                <TableCell className="font-medium">{line.label}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatHours(line.hours)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {money(line.hourlyRate)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(line.amount)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <dl className="ml-auto grid w-full max-w-xs gap-1 text-sm">
        <div className="flex justify-between text-muted-foreground">
          <dt>Billed hours</dt>
          <dd
            className="tabular-nums"
            data-testid={`${testIdPrefix}-hours`}
          >
            {formatHours(totalHours(lineItems))}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt>Subtotal</dt>
          <dd
            className="tabular-nums"
            data-testid={`${testIdPrefix}-subtotal`}
          >
            {money(subtotal)}
          </dd>
        </div>
        {taxRate === null ? null : (
          <div className="flex justify-between">
            <dt>{taxLabel(taxRate)}</dt>
            <dd className="tabular-nums" data-testid={`${testIdPrefix}-tax`}>
              {money(taxAmount)}
            </dd>
          </div>
        )}
        <div className="flex justify-between border-t border-border pt-1 text-base font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums" data-testid={`${testIdPrefix}-total`}>
            {money(total)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
