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
import { ORIGIN_ID } from "@/hooks/use-sync";
import { useFormatSettings } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import {
  useClientMutations,
  useProjectMutations,
} from "./use-catalog-mutations";
import { ProjectTasksField } from "./project-tasks-field";
import type { ClientRow, ProjectRow } from "./types";

export type ProjectFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omitted/null creates; otherwise the dialog edits this project. */
  project?: ProjectRow | null;
  clients: ClientRow[];
  /**
   * Called with the newly created project. Lets a caller act on the result —
   * the tracker's project picker selects it immediately, so "New project…"
   * leaves you ready to start the timer.
   */
  onCreated?: (project: { id: string; name: string }) => void;
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
  onCreated,
}: ProjectFormDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="project-dialog">
        {open ? (
          <ProjectForm
            key={project?.id ?? "new"}
            project={project ?? null}
            clients={clients}
            onDone={(created) => {
              onOpenChange(false);
              if (created) onCreated?.(created);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

type ProjectFormProps = {
  project: ProjectRow | null;
  clients: ClientRow[];
  /** Receives the created project on create; nothing on edit. */
  onDone: (created?: { id: string; name: string }) => void;
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
  const [pendingTasks, setPendingTasks] = React.useState<string[]>([]);
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [rateError, setRateError] = React.useState<string | null>(null);

  const { createProject, updateProject, isSaving } = useProjectMutations({
    onConflict: setNameError,
  });
  const { createClient } = useClientMutations();
  const utils = trpc.useUtils();
  const createTaskForNewProject = trpc.tasks.create.useMutation();

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

  const [creatingClient, setCreatingClient] = React.useState(false);
  const [newClientName, setNewClientName] = React.useState("");

  const confirmNewClient = (): void => {
    const name = newClientName.trim();
    if (name === "") return;
    handleCreateClient(name);
    setNewClientName("");
    setCreatingClient(false);
  };

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
    }).then(async (created) => {
      if (!created) return;

      // Tasks queued while the project had no id yet. Written in order so the
      // list reads the way it was typed.
      //
      // Guarded as a whole: the project itself already exists, so a task that
      // fails to write must not strand the dialog open with no way out.
      try {
        for (const taskName of pendingTasks) {
          await createTaskForNewProject
            .mutateAsync({
              projectId: created.id,
              name: taskName,
              originId: ORIGIN_ID,
            })
            .catch(() => null);
        }
        await utils.tasks.invalidate();
      } catch {
        toast.error("The project was created, but its tasks were not.");
      }

      toast.success(`Project "${created.name}" created.`);
      onDone(created);
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
          footerActions={[
            {
              label: "New client…",
              onSelect: () => setCreatingClient(true),
              testId: "project-client-new",
            },
          ]}
        />
        {creatingClient ? (
          <div className="flex gap-2">
            <Input
              autoFocus
              value={newClientName}
              placeholder="Client name"
              onChange={(event) => setNewClientName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  confirmNewClient();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setCreatingClient(false);
                  setNewClientName("");
                }
              }}
              data-testid="project-client-name-input"
            />
            <Button
              type="button"
              variant="outline"
              onClick={confirmNewClient}
              disabled={newClientName.trim() === ""}
              data-testid="project-client-name-save"
            >
              Add
            </Button>
          </div>
        ) : null}
      </div>

      <ProjectTasksField
        projectId={project?.id ?? null}
        pending={pendingTasks}
        onPendingChange={setPendingTasks}
      />

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
          // Wrapped: onDone takes an optional created project, and passing it
          // straight to onClick would hand it the mouse event instead.
          onClick={() => onDone()}
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
