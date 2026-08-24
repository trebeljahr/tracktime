"use client";

/**
 * Print / PDF export.
 *
 * The app chrome (sidebar, filter bar, popovers) has no business on paper, and
 * the report screens are theme-aware while print output must not be. So rather
 * than bolting `print:` variants onto the live DOM, a self-contained document
 * is composed in a new window and printed from there - which also gives the
 * browser's own "Save as PDF" for free.
 */

export type PrintAlign = "left" | "right";

export type PrintColumn = {
  key: string;
  header: string;
  align?: PrintAlign;
};

/** One row of the printed table, keyed by column key. */
export type PrintRow = Record<string, string>;

export type PrintDocument = {
  title: string;
  /** The reported date range, rendered under the title. */
  subtitle: string;
  /** Headline figures, e.g. "Total 12:30" - rendered as a KPI strip. */
  stats?: { label: string; value: string }[];
  /** Active filters, listed so a printout is self-describing. */
  meta?: string[];
  columns: PrintColumn[];
  rows: PrintRow[];
  /** Bold totals row appended to the table. */
  totals?: PrintRow;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const PRINT_STYLES = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 32px;
    background: #fff;
    color: #111;
    font: 12px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  h1 { margin: 0 0 4px; font-size: 20px; }
  .subtitle { margin: 0; color: #555; font-size: 13px; }
  .meta { margin: 12px 0 0; padding: 0; list-style: none; color: #555; font-size: 11px; }
  .meta li { display: inline-block; margin-right: 12px; }
  .stats { display: flex; flex-wrap: wrap; gap: 24px; margin: 20px 0 8px; }
  .stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #666; }
  .stat-value { font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #ddd; text-align: left; vertical-align: top; }
  th { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #666; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tfoot td { font-weight: 700; border-top: 2px solid #999; border-bottom: none; }
  tr { break-inside: avoid; }
  thead { display: table-header-group; }
  footer { margin-top: 24px; color: #888; font-size: 10px; }
  @page { margin: 14mm; }
`;

const renderCells = (
  columns: PrintColumn[],
  row: PrintRow,
  tag: "td" | "th"
): string =>
  columns
    .map((column) => {
      const align = column.align === "right" ? ' class="num"' : "";
      return `<${tag}${align}>${escapeHtml(row[column.key] ?? "")}</${tag}>`;
    })
    .join("");

/** Serialize a report into a standalone printable HTML document. */
export const buildPrintHtml = (doc: PrintDocument): string => {
  const head = doc.columns
    .map(
      (column) =>
        `<th${column.align === "right" ? ' class="num"' : ""}>${escapeHtml(
          column.header
        )}</th>`
    )
    .join("");

  const body =
    doc.rows.length === 0
      ? `<tr><td colspan="${doc.columns.length}">No time tracked in this range.</td></tr>`
      : doc.rows
          .map((row) => `<tr>${renderCells(doc.columns, row, "td")}</tr>`)
          .join("");

  const foot = doc.totals
    ? `<tfoot><tr>${renderCells(doc.columns, doc.totals, "td")}</tr></tfoot>`
    : "";

  const stats = (doc.stats ?? [])
    .map(
      (stat) =>
        `<div><div class="stat-label">${escapeHtml(
          stat.label
        )}</div><div class="stat-value">${escapeHtml(stat.value)}</div></div>`
    )
    .join("");

  const meta = (doc.meta ?? [])
    .map((entry) => `<li>${escapeHtml(entry)}</li>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(doc.title)}</title>
<style>${PRINT_STYLES}</style>
</head>
<body>
<h1>${escapeHtml(doc.title)}</h1>
<p class="subtitle">${escapeHtml(doc.subtitle)}</p>
${meta === "" ? "" : `<ul class="meta">${meta}</ul>`}
${stats === "" ? "" : `<div class="stats">${stats}</div>`}
<table>
<thead><tr>${head}</tr></thead>
<tbody>${body}</tbody>
${foot}
</table>
<footer>Generated ${escapeHtml(new Date().toLocaleString())} by tracktime</footer>
</body>
</html>`;
};

/**
 * Open the printable view and hand it to the browser's print dialog.
 * Returns false when a popup blocker got in the way, so the caller can say so.
 */
export const openPrintView = (doc: PrintDocument): boolean => {
  const target = window.open("", "_blank", "width=1024,height=768");
  if (target === null) return false;

  target.document.open();
  target.document.write(buildPrintHtml(doc));
  target.document.close();
  target.focus();
  target.print();
  return true;
};
