import { addDays, format, parseISO } from "date-fns";
import type { Invoice, InvoiceLineItem, InvoiceStatus } from "@starter/shared";

/**
 * The shapes and the rules the invoicing screens draw from.
 *
 * The router's own output types live behind `@starter/server/trpc`, which only
 * re-exports `AppRouter`, so — exactly as `components/catalog/types.ts` does —
 * the wire shapes are mirrored structurally here rather than imported. The
 * rules below are duplicated from the server ON PURPOSE and must stay in step
 * with it: the server is the authority, and every one of these functions only
 * decides what the UI is allowed to OFFER. Offering a move the server would
 * reject is a dead-end button; hiding one it would accept is a missing
 * feature. Both are caught by `types.test.ts`.
 */

/** An invoice exactly as `invoices.list` / `invoices.get` return it. */
export type InvoiceRow = Invoice;

export type InvoiceGroupBy = Invoice["groupBy"];

/** Mirrors the server's `InvoicePreview` — a dry run with nothing written. */
export type InvoicePreviewData = {
  clientId: string;
  clientName: string;
  groupBy: InvoiceGroupBy;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  taxRate: number | null;
  taxAmount: number;
  total: number;
  currency: string;
  /** The entries that would be billed. Empty means there is nothing to bill. */
  entryIds: string[];
  suggestedNumber: string;
  /** Billable time in range carrying no rate — cannot be invoiced. */
  skippedMissingRate: number;
  /** Time in range already billed on an earlier invoice. */
  skippedInvoiced: number;
};

/** What `invoices.remove` resolves to. */
export type InvoiceRemoveResult = {
  deleted: boolean;
  releasedEntries: number;
};

/** One canonical cache key, so optimistic reads and invalidation agree. */
export const INVOICE_LIST_INPUT: Record<string, never> = {};

// ── status ───────────────────────────────────────────────────────────

export const INVOICE_STATUSES: readonly InvoiceStatus[] = [
  "draft",
  "sent",
  "paid",
];

/**
 * Mirror of the server's transition table (`routers/invoices.ts`).
 *
 * draft → sent → paid, plus one step back for the mistakes people actually
 * make. draft → paid and paid → draft are deliberately absent.
 */
const ALLOWED_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  draft: ["draft", "sent"],
  sent: ["draft", "sent", "paid"],
  paid: ["sent", "paid"],
};

/**
 * The status changes the UI offers from `from` — the legal targets MINUS the
 * status it already has. Re-setting the current status is legal on the server
 * (a retried mutation must not fail) but is not a button anybody wants.
 */
export function statusTransitions(from: InvoiceStatus): InvoiceStatus[] {
  return ALLOWED_TRANSITIONS[from].filter((status) => status !== from);
}

/**
 * "Mark as sent" going forward, "Back to draft" going back — so a button that
 * walks the lifecycle backwards never reads like progress.
 */
export function statusActionLabel(
  from: InvoiceStatus,
  to: InvoiceStatus,
): string {
  const forward = INVOICE_STATUSES.indexOf(to) > INVOICE_STATUSES.indexOf(from);
  return forward ? `Mark as ${to}` : `Back to ${to}`;
}

export type BadgeTone = "default" | "secondary" | "outline" | "destructive";

/** Paid is the only status worth the loud badge. */
export function statusBadgeTone(status: InvoiceStatus): BadgeTone {
  switch (status) {
    case "paid":
      return "default";
    case "sent":
      return "secondary";
    case "draft":
      return "outline";
  }
}

/**
 * Only a draft can be deleted.
 *
 * A sent or paid invoice is a record of something that left the building, and
 * deleting it leaves a hole in the numbering somebody has to explain. The
 * server refuses it outright; the UI must not offer the button.
 */
export function canDeleteInvoice(status: InvoiceStatus): boolean {
  return status === "draft";
}

// ── preview exclusions ───────────────────────────────────────────────

export type ExclusionNotice = {
  id: "missing-rate" | "already-invoiced";
  tone: "warning" | "info";
  message: string;
};

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

/**
 * Turn the counts the preview reports into sentences.
 *
 * Both numbers are surfaced rather than hidden. An invoice that quietly bills
 * less time than the user tracked is the bug this whole screen exists to
 * avoid, and the two reasons time drops out have opposite meanings:
 *
 *  - NO RATE is a warning. That work is billable, nobody has billed it, and
 *    this invoice will not either — it needs a rate before it can be.
 *  - ALREADY INVOICED is reassurance, not a problem. It is the double-billing
 *    guard doing its job, and saying so is what makes a second invoice over
 *    the same range legible instead of looking broken.
 */
export function exclusionNotices(
  preview: Pick<InvoicePreviewData, "skippedMissingRate" | "skippedInvoiced">,
): ExclusionNotice[] {
  const notices: ExclusionNotice[] = [];

  if (preview.skippedMissingRate > 0) {
    notices.push({
      id: "missing-rate",
      tone: "warning",
      message: `${plural(preview.skippedMissingRate, "entry has", "entries have")} no hourly rate and cannot be billed. Set a rate on the project, then re-run this preview.`,
    });
  }

  if (preview.skippedInvoiced > 0) {
    notices.push({
      id: "already-invoiced",
      tone: "info",
      message: `${plural(preview.skippedInvoiced, "entry is", "entries are")} already on an earlier invoice and will not be billed again.`,
    });
  }

  return notices;
}

/** True when there is something to bill — the only state `create` accepts. */
export function previewIsBillable(
  preview: Pick<InvoicePreviewData, "entryIds"> | undefined,
): boolean {
  return (preview?.entryIds.length ?? 0) > 0;
}

/**
 * Why an empty preview is empty, in the user's terms.
 *
 * "Nothing to bill" alone is unhelpful when the reason is that it was all
 * billed last week — which is exactly the case a second invoice over the same
 * range hits.
 */
export function emptyPreviewReason(
  preview: Pick<InvoicePreviewData, "skippedMissingRate" | "skippedInvoiced">,
): string {
  if (preview.skippedInvoiced > 0 && preview.skippedMissingRate > 0) {
    return "Every billable hour in this range is either already invoiced or missing a rate.";
  }
  if (preview.skippedInvoiced > 0) {
    return "Every billable hour in this range has already been invoiced. The same time is never billed twice.";
  }
  if (preview.skippedMissingRate > 0) {
    return "The tracked time in this range carries no hourly rate, so there is nothing to bill.";
  }
  return "No billable, un-invoiced time was tracked for this client in this range.";
}

// ── display ──────────────────────────────────────────────────────────

/**
 * Hours on an invoice are decimal, always two places — "3.00 h", not
 * "3:00:00". A customer reconciles `hours × rate = amount` by eye, and that
 * only works if the quantity is the one the multiplication used.
 */
export function formatHours(hours: number): string {
  return `${(Number.isFinite(hours) ? hours : 0).toFixed(2)} h`;
}

/** Total decimal hours across the lines, for the summary row. */
export function totalHours(lineItems: readonly InvoiceLineItem[]): number {
  const seconds = lineItems.reduce((sum, line) => sum + line.seconds, 0);
  return Math.round((seconds / 3600) * 100) / 100;
}

/** "19% VAT" / "No tax" — the tax line's own label. */
export function taxLabel(taxRate: number | null): string {
  if (taxRate === null || !Number.isFinite(taxRate)) return "No tax";
  return `Tax (${Number.isInteger(taxRate) ? taxRate : taxRate.toFixed(2)}%)`;
}

// ── dates ────────────────────────────────────────────────────────────

/** Local "YYYY-MM-DD" — never `toISOString()`, which shifts across zones. */
export const toDateKey = (date: Date): string => format(date, "yyyy-MM-dd");

/** Shift a "YYYY-MM-DD" key by whole days, staying in local calendar terms. */
export function shiftDateKey(dateKey: string, days: number): string {
  const parsed = parseISO(dateKey.slice(0, 10));
  if (Number.isNaN(parsed.getTime())) return dateKey;
  return toDateKey(addDays(parsed, days));
}

/** Net-14 by default: today's issue date, due a fortnight later. */
export const DEFAULT_PAYMENT_DAYS = 14;

export function defaultInvoiceDates(now: Date = new Date()): {
  issueDate: string;
  dueDate: string;
} {
  const issueDate = toDateKey(now);
  return { issueDate, dueDate: shiftDateKey(issueDate, DEFAULT_PAYMENT_DAYS) };
}

/**
 * Keep the due date at or after the issue date.
 *
 * Moving the issue date forward past the due date must drag the due date with
 * it — the server rejects `dueDate < issueDate`, and a form that lets you
 * build a request it will refuse is a form that wastes a round trip to say so.
 */
export function reconcileDueDate(issueDate: string, dueDate: string): string {
  return dueDate < issueDate
    ? shiftDateKey(issueDate, DEFAULT_PAYMENT_DAYS)
    : dueDate;
}

/**
 * Parse the tax field.
 *
 * Empty means NO TAX LINE (null), which is not the same as 0% — a 0% line is
 * a deliberate statement and still prints. Anything unparseable or out of the
 * server's 0–100 range is rejected here so the mutation is never sent.
 */
export function parseTaxRate(
  raw: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };

  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { ok: false, error: "Enter a tax rate as a number, e.g. 19." };
  }
  if (value < 0 || value > 100) {
    return { ok: false, error: "A tax rate has to be between 0 and 100." };
  }
  return { ok: true, value };
}

/** "1 – 31 Aug 2026" for the billed range, from ISO instants or date keys. */
export function formatRange(from: string, to: string): string {
  const parse = (value: string): Date | null => {
    const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const start = parse(from);
  const end = parse(to);
  if (!start || !end) return `${from} – ${to}`;
  // The stored `to` is the EXCLUSIVE upper bound (midnight of the day after),
  // so the last billed day is the day before it.
  const lastDay = addDays(end, -1);
  const inclusiveEnd = lastDay.getTime() < start.getTime() ? end : lastDay;
  return `${format(start, "d MMM yyyy")} – ${format(inclusiveEnd, "d MMM yyyy")}`;
}

/** "21 Aug 2026" for a single ISO date. */
export function formatDate(iso: string): string {
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(date.getTime()) ? iso : format(date, "d MMM yyyy");
}

/** The date input's "YYYY-MM-DD" form of a stored ISO instant. */
export function toDateInputValue(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso.slice(0, 10) : toDateKey(date);
}
