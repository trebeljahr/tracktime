"use client";

import * as React from "react";

import { ColorPicker, COLOR_PALETTE } from "@/components/color-picker";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
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
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { useFormatSettings } from "@/lib/format";
import {
  useClientMutations,
  useProjectMutations,
} from "./use-catalog-mutations";
import type { ClientRow, ProjectRow } from "./types";

export type ProjectFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omitted/null creates; otherwise the dialog edits this project. */
  project?: ProjectRow | null;
  clients: ClientRow[];
};

const FALLBACK_COLOR = COLOR_PALETTE[0] ?? "#4f46e5";

/**
 * Create/edit dialog. The body is only mounted while `open`, so every field
 * re-initialises from props on each open without an effect syncing state.
 */
export function ProjectFormDialog({
  open,
  onOpenChange,
  project,
  clients,
}: ProjectFormDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="project-dialog">
        {open ? (
          <ProjectForm
            key={project?.id ?? "new"}
            project={project ?? null}
            clients={clients}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

type ProjectFormProps = {
  project: ProjectRow | null;
  clients: ClientRow[];
  onDone: () => void;
};

function ProjectForm({
  project,
  clients,
  onDone,
}: ProjectFormProps): React.JSX.Element {
  const { currency } = useFormatSettings();

  const [name, setName] = React.useState(project?.name ?? "");
  const [color, setColor] = React.useState(project?.color ?? FALLBACK_COLOR);
  const [clientId, setClientId] = React.useState<string | null>(
    project?.clientId ?? null,
  );
  const [billableDefault, setBillableDefault] = React.useState(
    project?.billableDefault ?? true,
  );
  const [rate, setRate] = React.useState(
    project?.hourlyRate === null || project?.hourlyRate === undefined
      ? ""
      : String(project.hourlyRate),
  );
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [rateError, setRateError] = React.useState<string | null>(null);

  const { createProject, updateProject, isSaving } = useProjectMutations({
    onConflict: setNameError,
  });
  const { createClient } = useClientMutations();

  const clientOptions = React.useMemo<ComboboxOption[]>(
    () =>
      clients
        .filter((client) => !client.archived || client.id === project?.clientId)
        .map((client) => ({
          value: client.id,
          label: client.archived ? `${client.name} (archived)` : client.name,
          color: client.color,
        })),
    [clients, project?.clientId],
  );

  const handleCreateClient = (rawName: string): void => {
    void createClient({ name: rawName.trim() }).then((created) => {
      if (created) setClientId(created.id);
    });
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setNameError(null);
    setRateError(null);

    const trimmed = name.trim();
    if (trimmed === "") {
      setNameError("Name is required");
      return;
    }

    let hourlyRate: number | null = null;
    if (rate.trim() !== "") {
      const parsed = Number(rate.trim().replace(",", "."));
      if (!Number.isFinite(parsed) || parsed < 0) {
        setRateError("Enter a rate of 0 or more, or leave it empty");
        return;
      }
      hourlyRate = parsed;
    }

    if (project) {
      void updateProject({
        id: project.id,
        name: trimmed,
        color,
        clientId,
        billableDefault,
        hourlyRate,
      }).then((saved) => {
        if (!saved) return;
        toast.success("Project saved.");
        onDone();
      });
      return;
    }

    void createProject({
      name: trimmed,
      color,
      clientId,
      billableDefault,
      hourlyRate,
    }).then((created) => {
      if (!created) return;
      toast.success(`Project "${created.name}" created.`);
      onDone();
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{project ? "Edit project" : "New project"}</DialogTitle>
        <DialogDescription>
          Projects group tracked time and carry the billing defaults for new
          entries.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <Label htmlFor="project-name">Name</Label>
        <div className="flex items-center gap-2">
          <ColorPicker
            value={color}
            onChange={setColor}
            testId="project-color"
          />
          <Input
            id="project-name"
            value={name}
            autoFocus
            maxLength={120}
            placeholder="Website redesign"
            aria-invalid={nameError !== null}
            onChange={(event) => {
              setName(event.target.value);
              if (nameError) setNameError(null);
            }}
            data-testid="project-name-input"
          />
        </div>
        {nameError ? (
          <p className="text-sm text-destructive" data-testid="project-name-error">
            {nameError}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="project-client">Client</Label>
        <Combobox
          id="project-client"
          className="w-full"
          options={clientOptions}
          value={clientId}
          onChange={setClientId}
          placeholder="No client"
          searchPlaceholder="Search clients..."
          emptyText="No clients yet."
          allowClear
          clearLabel="No client"
          onCreate={handleCreateClient}
          data-testid="project-client-combobox"
        />
      </div>

      <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
        <div className="space-y-0.5">
          <Label htmlFor="project-billable">Billable by default</Label>
          <p className="text-xs text-muted-foreground">
            New entries on this project start as billable.
          </p>
        </div>
        <Switch
          id="project-billable"
          checked={billableDefault}
          onCheckedChange={setBillableDefault}
          data-testid="project-billable-switch"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="project-rate">Hourly rate ({currency})</Label>
        <Input
          id="project-rate"
          inputMode="decimal"
          value={rate}
          placeholder="Workspace default"
          aria-invalid={rateError !== null}
          onChange={(event) => {
            setRate(event.target.value);
            if (rateError) setRateError(null);
          }}
          data-testid="project-rate-input"
        />
        <p className="text-xs text-muted-foreground">
          Leave empty to fall back to the workspace default rate.
        </p>
        {rateError ? (
          <p className="text-sm text-destructive" data-testid="project-rate-error">
            {rateError}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onDone}
          data-testid="project-cancel"
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSaving} data-testid="project-submit">
          {project ? "Save changes" : "Create project"}
        </Button>
      </DialogFooter>
    </form>
  );
}
