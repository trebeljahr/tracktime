"use client";

import * as React from "react";

import { InvoicesScreen } from "@/components/invoices/invoices-screen";

export default function InvoicesPage(): React.JSX.Element {
  return (
    <div className="space-y-6" data-testid="invoices-page">
      <header>
        <h1 className="text-2xl font-bold">Invoices</h1>
        <p className="text-sm text-muted-foreground">
          Bill a client for a range of tracked time. Time that has already been
          invoiced is never offered a second time.
        </p>
      </header>
      <InvoicesScreen />
    </div>
  );
}
