// The bound on one export, pinned at its boundary.
//
// The failure this guards against is not an error — it is the absence of one.
// A `.limit(MAX)` returns a full page whether the range ended there or the
// ceiling did, so a truncated backup would download, open, and read as
// complete. Reading one PAST the cap is what makes the two cases different,
// and these tests fix which side of the line each count falls on.
import assert from "node:assert/strict";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import {
  MAX_EXPORT_ENTRIES,
  MAX_EXPORT_INVOICES,
  assertExportInvoicesWithinCap,
  assertExportWithinCap,
} from "../trpc/routers/data.js";

test("a read that filled the cap exactly is a complete export", () => {
  assert.doesNotThrow(() => {
    assertExportWithinCap(MAX_EXPORT_ENTRIES);
  });
});

test("an empty and a partial read pass", () => {
  assert.doesNotThrow(() => {
    assertExportWithinCap(0);
  });
  assert.doesNotThrow(() => {
    assertExportWithinCap(1);
  });
  assert.doesNotThrow(() => {
    assertExportWithinCap(MAX_EXPORT_ENTRIES - 1);
  });
});

test("one row past the cap is refused, not truncated", () => {
  assert.throws(
    () => {
      assertExportWithinCap(MAX_EXPORT_ENTRIES + 1);
    },
    (error: unknown) => {
      assert.ok(error instanceof TRPCError);
      // BAD_REQUEST rather than a 500: the request is answerable, just not in
      // one file, and the client renders the message as a readable refusal.
      assert.equal(error.code, "BAD_REQUEST");
      return true;
    },
  );
});

test("the refusal names the number and what to do about it", () => {
  try {
    assertExportWithinCap(MAX_EXPORT_ENTRIES + 1);
    assert.fail("expected a refusal");
  } catch (error) {
    assert.ok(error instanceof TRPCError);
    // Grouped, so 200,000 reads as a quantity rather than a digit soup.
    assert.match(error.message, /200,000/);
    // The remedy has to be reachable from the export panel, which is why the
    // panel carries a date range at all. A message telling the user to do
    // something the screen does not offer is not a remedy.
    assert.match(error.message, /date range/i);
  }
});

test("invoices are bounded by a refusal too, not by a quiet limit", () => {
  // The rule is the entries' rule, and the invoice read is the one that broke
  // it: a plain `.limit()` returns the oldest N by issue date and drops the
  // newest, in a file that still opens as a complete backup of the billing.
  assert.doesNotThrow(() => {
    assertExportInvoicesWithinCap(0);
  });
  assert.doesNotThrow(() => {
    assertExportInvoicesWithinCap(MAX_EXPORT_INVOICES);
  });
  assert.throws(
    () => {
      assertExportInvoicesWithinCap(MAX_EXPORT_INVOICES + 1);
    },
    (error: unknown) => {
      assert.ok(error instanceof TRPCError);
      assert.equal(error.code, "BAD_REQUEST");
      // Names the number and the remedy the panel actually offers, exactly as
      // the entry refusal does — the two are read on the same screen.
      assert.match(error.message, /10,000/);
      assert.match(error.message, /invoices/);
      assert.match(error.message, /date range/i);
      return true;
    },
  );
});

test("the two caps are separate numbers and neither stands in for the other", () => {
  // A workspace can be far past one ceiling and nowhere near the other, so a
  // single shared bound would refuse exports that are perfectly whole.
  assert.doesNotThrow(() => {
    assertExportWithinCap(MAX_EXPORT_INVOICES + 1);
  });
  assert.throws(() => {
    assertExportInvoicesWithinCap(MAX_EXPORT_ENTRIES);
  });
});
