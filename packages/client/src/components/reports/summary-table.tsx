"use client";

import * as React from "react";
import type { SummaryGroup } from "@starter/shared";

import { BudgetMeterCell } from "@/components/budget-meter";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { colorForGroup } from "@/components/reports/summary-charts";
import type { BudgetView } from "@/lib/budget-view";

export type SummaryTableProps = {
  groups: SummaryGroup[];
  totalSec: number;
  billableSec: number;
  totalAmount: number;
  duration: (seconds: number) => string;
  money: (amount: number) => string;
  /** Column heading for the group key, e.g. "Project". */
  dimensionLabel: string;
  /**
   * Lifetime budget progress for a group, when the dimension has one.
   * Omitted entirely for dimensions that cannot carry a budget (day, client,
   * …), which is what hides the column.
   */
  budgetFor?: (groupKey: string) => BudgetView | null;
};

/** Grouped totals, biggest first, with an inline share-of-total bar. */
export function SummaryTable({
  groups,
  totalSec,
  billableSec,
  totalAmount,
  duration,
  money,
  dimensionLabel,
  budgetFor,
}: SummaryTableProps): React.JSX.Element {
  const rows = React.useMemo(
    () => [...groups].sort((a, b) => b.seconds - a.seconds),
    [groups]
  );

  const denominator = totalSec > 0 ? totalSec : 1;

  return (
    <Table data-testid="summary-table">
      <TableHeader>
        <TableRow>
          <TableHead>{dimensionLabel}</TableHead>
          <TableHead className="w-[28%]">Share</TableHead>
          <TableHead className="text-right">Billable</TableHead>
          <TableHead className="text-right">Duration</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          {budgetFor ? (
            <TableHead className="w-52">
              Budget
              <span className="ml-1 font-normal text-muted-foreground">
                (lifetime)
              </span>
            </TableHead>
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((group, index) => {
          const share = (group.seconds / denominator) * 100;
          const color = colorForGroup(group, index);
          return (
            <TableRow key={group.key} data-testid={`summary-row-${group.key}`}>
              <TableCell className="font-medium">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="truncate">{group.label}</span>
                </span>
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="h-2 min-w-8 flex-1 overflow-hidden rounded-full bg-muted"
                  >
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${Math.max(share, share > 0 ? 2 : 0)}%`,
                        backgroundColor: color,
                      }}
                    />
                  </span>
                  <span className="w-11 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {share.toFixed(1)}%
                  </span>
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {duration(group.billableSec)}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {duration(group.seconds)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {money(group.amount)}
              </TableCell>
              {budgetFor ? (
                <TableCell data-testid={`summary-budget-${group.key}`}>
                  {/*
                   * A budget is a lifetime target while these totals are
                   * range-scoped, so the meter deliberately reports the whole
                   * project rather than the filtered slice — hence the column
                   * heading saying so.
                   */}
                  <BudgetMeterCell
                    view={budgetFor(group.key)}
                    emptyLabel="—"
                    testId={`summary-budget-meter-${group.key}`}
                  />
                </TableCell>
              ) : null}
            </TableRow>
          );
        })}
      </TableBody>
      <TableFooter>
        <TableRow data-testid="summary-total-row">
          <TableCell>Total</TableCell>
          <TableCell />
          <TableCell className="text-right tabular-nums">
            {duration(billableSec)}
          </TableCell>
          <TableCell
            className="text-right tabular-nums"
            data-testid="summary-total-duration"
          >
            {duration(totalSec)}
          </TableCell>
          <TableCell
            className="text-right tabular-nums"
            data-testid="summary-total-amount"
          >
            {money(totalAmount)}
          </TableCell>
          {budgetFor ? <TableCell /> : null}
        </TableRow>
      </TableFooter>
    </Table>
  );
}
