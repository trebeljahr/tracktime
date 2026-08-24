"use client";

import * as React from "react";

import { ColorPicker, COLOR_PALETTE } from "@/components/color-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { useClientMutations } from "./use-catalog-mutations";
import type { ClientRow } from "./types";

export type ClientFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omitted/null creates; otherwise the dialog edits this client. */
  client?: ClientRow | null;
};

const FALLBACK_COLOR = COLOR_PALETTE[0] ?? "#4f46e5";

export function ClientFormDialog({
  open,
  onOpenChange,
  client,
}: ClientFormDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="client-dialog">
        {open ? (
          <ClientForm
            key={client?.id ?? "new"}
            client={client ?? null}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

type ClientFormProps = {
  client: ClientRow | null;
  onDone: () => void;
};

function ClientForm({ client, onDone }: ClientFormProps): React.JSX.Element {
  const [name, setName] = React.useState(client?.name ?? "");
  const [color, setColor] = React.useState(client?.color ?? FALLBACK_COLOR);
  const [nameError, setNameError] = React.useState<string | null>(null);

  const { createClient, updateClient, isSaving } = useClientMutations({
    onConflict: setNameError,
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setNameError(null);

    const trimmed = name.trim();
    if (trimmed === "") {
      setNameError("Name is required");
      return;
    }

    if (client) {
      void updateClient({ id: client.id, name: trimmed, color }).then(
        (saved) => {
          if (!saved) return;
          toast.success("Client saved.");
          onDone();
        },
      );
      return;
    }

    void createClient({ name: trimmed, color }).then((created) => {
      if (!created) return;
      toast.success(`Client "${created.name}" created.`);
      onDone();
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{client ? "Edit client" : "New client"}</DialogTitle>
        <DialogDescription>
          Clients sit above projects and roll their tracked time together.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <Label htmlFor="client-name">Name</Label>
        <div className="flex items-center gap-2">
          <ColorPicker value={color} onChange={setColor} testId="client-color" />
          <Input
            id="client-name"
            value={name}
            autoFocus
            maxLength={120}
            placeholder="Acme Inc."
            aria-invalid={nameError !== null}
            onChange={(event) => {
              setName(event.target.value);
              if (nameError) setNameError(null);
            }}
            data-testid="client-name-input"
          />
        </div>
        {nameError ? (
          <p className="text-sm text-destructive" data-testid="client-name-error">
            {nameError}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onDone}
          data-testid="client-cancel"
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSaving} data-testid="client-submit">
          {client ? "Save changes" : "Create client"}
        </Button>
      </DialogFooter>
    </form>
  );
}
