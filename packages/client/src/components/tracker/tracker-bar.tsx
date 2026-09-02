"use client";

import * as React from "react";
import { CloudOff, Play, Plus, Square, Timer, WifiOff } from "lucide-react";
import { formatDuration } from "@starter/shared";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { DurationInput } from "@/components/duration-input";
import { ProjectPicker } from "@/components/project-picker";
import { TaskPicker } from "@/components/task-picker";
import { TagPicker } from "@/components/tags/tag-picker";
import { BillableGlyph } from "@/components/tracker/billable-glyph";
import { QuickStartRow } from "@/components/tracker/quick-start-row";
import { TimeField } from "@/components/tracker/time-field";
import {
  requestPomodoroPermission,
  usePomodoro,
} from "@/components/tracker/use-pomodoro";
import { useEntryMutations } from "@/components/tracker/use-entry-mutations";
import { useIdleGuard } from "@/components/tracker/use-idle-guard";
import { useRunawayGuard } from "@/components/tracker/use-runaway-guard";
import { useOfflineQueue } from "@/hooks/use-offline-queue";
import { useRunningEntry } from "@/hooks/use-sync";
import { useFormatSettings } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type TrackerMode = "timer" | "manual";

const HOUR_MS = 3_600_000;

const defaultManualRange = (): { start: string; end: string } => {
  const end = new Date();
  end.setSeconds(0, 0);
  return {
    start: new Date(end.getTime() - HOUR_MS).toISOString(),
    end: end.toISOString(),
  };
};

const clampEnd = (start: string, end: string): string =>
  Date.parse(end) > Date.parse(start)
    ? end
    : new Date(Date.parse(start) + 60_000).toISOString();

/**
 * The bar the whole product is used through: description, project, billable,
 * the live elapsed clock and one big Start/Stop button — plus a manual mode
 * that swaps the clock for an explicit start/end range.
 */
export function TrackerBar(): React.JSX.Element {
  const { entry: running, elapsedSec } = useRunningEntry();
  const format = useFormatSettings();
  const mutations = useEntryMutations();
  useRunawayGuard(mutations);
  const { pending, online } = useOfflineQueue();
  const projects = trpc.projects.list.useQuery({});

  const [mode, setMode] = React.useState<TrackerMode>("timer");
  const [description, setDescription] = React.useState("");
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [taskId, setTaskId] = React.useState<string | null>(null);
  const [billable, setBillable] = React.useState(false);
  const [tagIds, setTagIds] = React.useState<string[]>([]);
  const [manual, setManual] = React.useState(defaultManualRange);

  const isRunning = running !== null;

  // Adopt the running entry's fields whenever the timer identity changes —
  // including a start or stop that happened on another device. Render-time
  // sync (rather than an effect) keeps the inputs correct on the very first
  // paint after a cross-device change.
  const runningId = running?.id ?? null;
  const [lastRunningId, setLastRunningId] = React.useState<string | null>(null);
  if (lastRunningId !== runningId) {
    setLastRunningId(runningId);
    setDescription(running?.description ?? "");
    setProjectId(running?.projectId ?? null);
    setTaskId(running?.taskId ?? null);
    setBillable(running?.billable ?? false);
    setTagIds(running?.tagIds ?? []);
  }

  const pomodoro = usePomodoro({
    config: format.settings.pomodoro,
    running: isRunning,
  });

  // Mounted here rather than in the app shell so the detector lives exactly as
  // long as the screen that owns the timer.
  useIdleGuard();

  // Live elapsed time in the tab title, so a backgrounded tab still shows it.
  React.useEffect(() => {
    if (running === null) {
      document.title = "tracktime";
      return;
    }
    const label = running.description.trim();
    document.title = `${formatDuration(elapsedSec, "hms")}${label === "" ? "" : ` · ${label}`}`;
    return () => {
      document.title = "tracktime";
    };
  }, [running, elapsedSec]);

  const projectBillableDefault = React.useCallback(
    (nextProjectId: string | null): boolean => {
      if (nextProjectId === null) return false;
      const project = projects.data?.find(
        (candidate) => candidate.id === nextProjectId
      );
      return project?.billableDefault ?? false;
    },
    [projects.data]
  );

  const handleProjectChange = React.useCallback(
    (nextProjectId: string | null): void => {
      const projectChanged = nextProjectId !== projectId;
      setProjectId(nextProjectId);
      // A task belongs to one project, so it cannot survive a project change.
      if (projectChanged) setTaskId(null);
      if (isRunning && running) {
        mutations.updateEntry({
          id: running.id,
          projectId: nextProjectId,
          ...(projectChanged ? { taskId: null } : {}),
        });
        return;
      }
      setBillable(projectBillableDefault(nextProjectId));
    },
    [isRunning, mutations, projectBillableDefault, projectId, running]
  );

  const handleTaskChange = React.useCallback(
    (nextTaskId: string | null): void => {
      setTaskId(nextTaskId);
      if (isRunning && running) {
        mutations.updateEntry({ id: running.id, taskId: nextTaskId });
      }
    },
    [isRunning, mutations, running]
  );

  const handleTagsChange = React.useCallback(
    (next: string[]): void => {
      setTagIds(next);
      // Labelling a running entry has to stick immediately — the whole point
      // of tagging as you go is that you do it while the timer runs.
      if (isRunning && running) {
        mutations.updateEntry({ id: running.id, tagIds: next });
      }
    },
    [isRunning, mutations, running]
  );

  const handleBillableToggle = React.useCallback((): void => {
    const next = !billable;
    setBillable(next);
    if (isRunning && running) {
      mutations.updateEntry({ id: running.id, billable: next });
    }
  }, [billable, isRunning, mutations, running]);

  const commitDescription = React.useCallback((): void => {
    if (!isRunning || running === null) return;
    if (description === running.description) return;
    mutations.updateEntry({ id: running.id, description });
  }, [description, isRunning, mutations, running]);

  const start = React.useCallback((): void => {
    requestPomodoroPermission(format.settings.pomodoro);
    mutations.startTimer({ description, projectId, taskId, billable, tagIds });
  }, [billable, description, mutations, projectId, tagIds, taskId]);

  const stop = React.useCallback((): void => {
    mutations.stopTimer();
  }, [mutations]);

  const toggle = React.useCallback((): void => {
    if (isRunning) stop();
    else start();
  }, [isRunning, start, stop]);

  const addManual = React.useCallback((): void => {
    const end = clampEnd(manual.start, manual.end);
    mutations.createManualEntry({
      description,
      projectId,
      taskId,
      billable,
      tagIds,
      start: manual.start,
      end,
    });
    setDescription("");
    // Tags deliberately survive: consecutive manual entries are usually the
    // same kind of work, and re-picking the label every time is what stops
    // people from tagging at all.
    setManual(defaultManualRange());
  }, [billable, description, manual, mutations, projectId, tagIds, taskId]);

  const submit = React.useCallback((): void => {
    if (mode === "manual") addManual();
    else toggle();
  }, [addManual, mode, toggle]);

  // Cmd/Ctrl+Enter toggles the timer from anywhere on the page, including
  // from inside another field.
  const toggleRef = React.useRef(toggle);
  React.useEffect(() => {
    toggleRef.current = toggle;
  }, [toggle]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Enter") return;
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      toggleRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const manualSeconds = Math.max(
    0,
    Math.round((Date.parse(manual.end) - Date.parse(manual.start)) / 1000)
  );

  return (
    <div
      className="sticky top-14 z-30 -mx-3 mb-6 border-b border-border bg-background/95 px-3 py-3 backdrop-blur md:-mx-6 md:px-6"
      data-testid="tracker-bar"
    >
      {/* Above the fields on purpose: the whole point is to not have to fill
          them in. Hidden while a timer runs, where the row would only offer to
          stop this one and start another. */}
      {isRunning ? null : <QuickStartRow mutations={mutations} />}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={description}
          autoFocus
          placeholder="What are you working on?"
          aria-label="Description"
          className="h-10 min-w-0 flex-1 basis-64 border-0 bg-transparent px-2 text-base shadow-none focus-visible:ring-0"
          onChange={(event) => setDescription(event.target.value)}
          onBlur={commitDescription}
          onKeyDown={(event) => {
            // Cmd/Ctrl+Enter is handled by the page-wide shortcut; letting it
            // through here too would toggle the timer twice.
            if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
              event.preventDefault();
              commitDescription();
              submit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setDescription(running?.description ?? "");
              event.currentTarget.blur();
            }
          }}
          data-testid="tracker-description"
        />

        <ProjectPicker
          value={projectId}
          onChange={handleProjectChange}
          className="h-10 border-0 shadow-none"
          testId="tracker-project"
        />

        <TaskPicker
          projectId={projectId}
          value={taskId}
          onChange={handleTaskChange}
          className="h-10 border-0 shadow-none"
          testId="tracker-task"
        />

        <TagPicker
          value={tagIds}
          onChange={handleTagsChange}
          maxChips={2}
          className="h-10 border-0 shadow-none"
          testId="tracker-tags"
        />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={billable ? "Billable" : "Not billable"}
          aria-pressed={billable}
          title={billable ? "Billable" : "Not billable"}
          onClick={handleBillableToggle}
          data-testid="tracker-billable"
          data-billable={billable ? "true" : "false"}
        >
          <BillableGlyph billable={billable} />
        </Button>

        <Separator orientation="vertical" className="hidden h-8 sm:block" />

        {mode === "timer" ? (
          <span
            className="w-24 shrink-0 text-right font-mono text-lg tabular-nums"
            data-testid="tracker-elapsed"
            data-running={isRunning ? "true" : "false"}
          >
            {format.duration(isRunning ? elapsedSec : 0)}
          </span>
        ) : (
          <div className="flex items-center gap-1">
            <TimeField
              value={manual.start}
              timeFormat={format.timeFormat}
              aria-label="Start time"
              testId="tracker-start-time"
              onCommit={(iso) =>
                setManual((current) => ({
                  start: iso,
                  end: clampEnd(iso, current.end),
                }))
              }
            />
            <span className="text-muted-foreground">–</span>
            <TimeField
              value={manual.end}
              timeFormat={format.timeFormat}
              aria-label="End time"
              testId="tracker-end-time"
              onCommit={(iso) =>
                setManual((current) => ({
                  start: current.start,
                  end: clampEnd(current.start, iso),
                }))
              }
            />
            <DurationInput
              value={manualSeconds}
              format={format.durationFormat}
              aria-label="Duration"
              testId="tracker-duration"
              className="h-8 w-24"
              onCommit={(seconds) =>
                setManual((current) => ({
                  start: current.start,
                  end: new Date(
                    Date.parse(current.start) + Math.max(60, seconds) * 1000
                  ).toISOString(),
                }))
              }
            />
          </div>
        )}

        <Button
          type="button"
          className={cn(
            "w-24 shrink-0",
            isRunning &&
              mode === "timer" &&
              "bg-destructive text-destructive-foreground hover:bg-destructive/90"
          )}
          onClick={submit}
          data-testid="tracker-toggle"
          data-state={mode === "manual" ? "add" : isRunning ? "running" : "idle"}
        >
          {mode === "manual" ? (
            <>
              <Plus /> Add
            </>
          ) : isRunning ? (
            <>
              <Square /> Stop
            </>
          ) : (
            <>
              <Play /> Start
            </>
          )}
        </Button>

        <div className="flex shrink-0 items-center rounded-md border border-border p-0.5">
          <Button
            type="button"
            variant={mode === "timer" ? "secondary" : "ghost"}
            size="icon"
            className="size-7"
            aria-label="Timer mode"
            aria-pressed={mode === "timer"}
            onClick={() => setMode("timer")}
            data-testid="tracker-mode-timer"
          >
            <Timer />
          </Button>
          <Button
            type="button"
            variant={mode === "manual" ? "secondary" : "ghost"}
            size="icon"
            className="size-7"
            aria-label="Manual mode"
            aria-pressed={mode === "manual"}
            onClick={() => setMode("manual")}
            data-testid="tracker-mode-manual"
          >
            <Plus />
          </Button>
        </div>
      </div>

      {pomodoro.active || pending > 0 || !online ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {pomodoro.active ? (
            <Badge
              variant="secondary"
              className="gap-1.5 font-mono tabular-nums"
              data-testid="pomodoro-indicator"
              data-phase={pomodoro.phase}
            >
              <span className="font-sans">{pomodoro.label}</span>
              <span data-testid="pomodoro-remaining">
                {formatDuration(pomodoro.remainingSec, "hms")}
              </span>
            </Badge>
          ) : null}

          {!online ? (
            <Badge variant="outline" className="gap-1.5" data-testid="offline-indicator">
              <WifiOff className="size-3" /> Offline
            </Badge>
          ) : null}

          {pending > 0 ? (
            <Badge
              variant="outline"
              className="gap-1.5"
              data-testid="offline-pending"
              data-pending={pending}
            >
              <CloudOff className="size-3" />
              {pending} change{pending === 1 ? "" : "s"} pending
            </Badge>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
