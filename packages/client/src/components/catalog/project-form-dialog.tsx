"use client";

import * as React from "react";
import {
  IDLE_BEHAVIORS,
  idleBehaviorLabel,
  type IdleBehavior,
} from "@starter/shared";

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

/** Sentinel for a field that was filled in with something unusable. */
const INVALID = Symbol("invalid");

/**
 * An optional numeric target: empty means "no target" (null), anything else
 * must parse to a number of 0 or more. Zero is a legitimate target and must
 * survive the round trip as 0, never as null.
 */
function parseTarget(raw: string): number | null | typeof INVALID {
  if (raw.trim() === "") return null;
  const parsed = Number(raw.trim().replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) return INVALID;
  return parsed;
}

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
  const [estimate, setEstimate] = React.useState(
    project?.estimatedHours === null || project?.estimatedHours === undefined
      ? ""
      : String(project.estimatedHours),
  );
  const [budget, setBudget] = React.useState(
    project?.budgetAmount === null || project?.budgetAmount === undefined
      ? ""
      : String(project.budgetAmount),
  );
  const [idleBehavior, setIdleBehavior] = React.useState<IdleBehavior | "">(
    project?.idleBehavior ?? "",
  );
  const [pendingTasks, setPendingTasks] = React.useState<string[]>([]);
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [rateError, setRateError] = React.useState<string | null>(null);
  const [estimateError, setEstimateError] = React.useState<string | null>(null);
  const [budgetError, setBudgetError] = React.useState<string | null>(null);

  // A budget keeps the currency it was agreed in. Only a project without one
  // yet picks up today's workspace currency.
  const budgetCurrency = project?.budgetCurrency ?? currency;

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
    setEstimateError(null);
    setBudgetError(null);

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

    // An empty field means "no target" and is sent as null; 0 is a target the
    // project is already over. The two must never collapse into each other.
    const estimatedHours = parseTarget(estimate);
    if (estimatedHours === INVALID) {
      setEstimateError("Enter hours of 0 or more, or leave it empty");
      return;
    }
    const budgetAmount = parseTarget(budget);
    if (budgetAmount === INVALID) {
      setBudgetError("Enter an amount of 0 or more, or leave it empty");
      return;
    }
    // "" is the inherit option, and has to reach the server as null rather
    // than being dropped — otherwise clearing an override would be a no-op.
    const idle: IdleBehavior | null = idleBehavior === "" ? null : idleBehavior;

    if (project) {
      void updateProject({
        id: project.id,
        name: trimmed,
        color,
        clientId,
        billableDefault,
        hourlyRate,
        estimatedHours,
        budgetAmount,
        ...(budgetAmount === null ? {} : { budgetCurrency }),
        idleBehavior: idle,
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
      estimatedHours,
      budgetAmount,
      ...(budgetAmount === null ? {} : { budgetCurrency }),
      idleBehavior: idle,
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

      <fieldset className="space-y-3 rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-medium">Estimate &amp; budget</legend>
        <p className="text-xs text-muted-foreground">
          Lifetime targets for the whole project, not a monthly allowance.
          Leave a field empty for no target — that is not the same as a target
          of zero.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="project-estimate">Estimated hours</Label>
            <Input
              id="project-estimate"
              inputMode="decimal"
              value={estimate}
              placeholder="No estimate"
              aria-invalid={estimateError !== null}
              onChange={(event) => {
                setEstimate(event.target.value);
                if (estimateError) setEstimateError(null);
              }}
              data-testid="project-estimate-input"
            />
            {estimateError ? (
              <p
                className="text-sm text-destructive"
                data-testid="project-estimate-error"
              >
                {estimateError}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="project-budget">Budget ({budgetCurrency})</Label>
            <Input
              id="project-budget"
              inputMode="decimal"
              value={budget}
              placeholder="No budget"
              aria-invalid={budgetError !== null}
              onChange={(event) => {
                setBudget(event.target.value);
                if (budgetError) setBudgetError(null);
              }}
              data-testid="project-budget-input"
            />
            {budgetError ? (
              <p
                className="text-sm text-destructive"
                data-testid="project-budget-error"
              >
                {budgetError}
              </p>
            ) : null}
          </div>
        </div>

        {project?.budgetCurrency !== null &&
        project?.budgetCurrency !== undefined &&
        project.budgetCurrency !== currency ? (
          <p
            className="text-xs text-muted-foreground"
            data-testid="project-budget-currency-note"
          >
            This budget is in {project.budgetCurrency}, the workspace currency
            when it was set. Time tracked in {currency} is reported separately
            rather than converted.
          </p>
        ) : null}
      </fieldset>
      <div className="space-y-2">
        <Label htmlFor="project-idle">When you go idle</Label>
        <select
          id="project-idle"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={idleBehavior}
          onChange={(event) =>
            setIdleBehavior(event.target.value as IdleBehavior | "")
          }
          data-testid="project-idle-behavior"
        >
          <option value="">Use the workspace setting</option>
          {IDLE_BEHAVIORS.map((behavior) => (
            <option key={behavior} value={behavior}>
              {idleBehaviorLabel(behavior)}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Pick “Keep running” for work that produces no typing — meetings,
          calls, reading. It never switches idle detection on; that stays a
          workspace setting.
        </p>
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
