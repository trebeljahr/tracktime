import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { invoicedEntryEditRefusal } from "../trpc/routers/entries.js";

/**
 * `Invoice.entryIds` + `TimeEntry.invoiceId` stop the same time being billed
 * twice. These tests pin the other half of that guarantee: once time HAS been
 * billed, the entry may no longer move underneath the invoice that billed it.
 */
describe("editing an already-invoiced entry", () => {
  it("allows anything on an entry that was never invoiced", () => {
    assert.equal(
      invoicedEntryEditRefusal(null, ["start", "end", "projectId"]),
      null,
    );
    assert.equal(
      invoicedEntryEditRefusal(undefined, ["billable"]),
      null,
    );
  });

  it("refuses a change to a field the invoice was calculated from", () => {
    for (const field of ["projectId", "taskId", "billable", "start", "end"]) {
      const refusal = invoicedEntryEditRefusal("invoice-1", [field]);
      assert.ok(
        refusal !== null,
        `changing ${field} on invoiced time must be refused`,
      );
      assert.match(refusal, new RegExp(field));
    }
  });

  it("still allows relabelling billed time", () => {
    // Neither reaches a line item, so an invoiced entry can still be described
    // and tagged — the guard is about money, not about bookkeeping notes.
    assert.equal(
      invoicedEntryEditRefusal("invoice-1", ["description"]),
      null,
    );
    assert.equal(invoicedEntryEditRefusal("invoice-1", ["tagIds"]), null);
    assert.equal(
      invoicedEntryEditRefusal("invoice-1", ["description", "tagIds"]),
      null,
    );
  });

  it("names every blocked field, not just the first", () => {
    const refusal = invoicedEntryEditRefusal("invoice-1", [
      "description",
      "start",
      "end",
    ]);
    assert.ok(refusal !== null);
    assert.match(refusal, /start/);
    assert.match(refusal, /end/);
    // The allowed field is not blamed for the refusal.
    assert.doesNotMatch(refusal, /description cannot/);
  });

  it("tells the user how to get unstuck", () => {
    const refusal = invoicedEntryEditRefusal("invoice-1", ["start"]);
    assert.ok(refusal !== null);
    assert.match(refusal, /draft/);
  });

  it("refuses nothing when no billing-relevant field is touched", () => {
    assert.equal(invoicedEntryEditRefusal("invoice-1", []), null);
  });
});
