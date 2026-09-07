import {
  Action,
  ActionPanel,
  Alert,
  Color,
  Icon,
  List,
  Toast,
  confirmAlert,
  showToast,
} from "@raycast/api";
import type { Task } from "@starter/core";
import { getTracktime, type ProjectWithStats } from "../../lib/api.js";
import { describeRemoval } from "../../lib/catalog.js";
import { formatDurationShort } from "../../lib/format.js";
import { useApi } from "../../lib/hooks.js";
import { refreshMenuBar, showFailureToast } from "../../lib/ui.js";
import { TaskForm } from "./task-form.js";

type Props = { project: ProjectWithStats };

/** The tasks of one project — the level below `projects.tsx`. */
export function ProjectTasks({ project }: Props): React.JSX.Element {
  const tasks = useApi(`tasks:all:${project.id}`, (api) =>
    api.tasks(project.id, { includeArchived: true }),
  );

  const run = async (
    action: () => Promise<string>,
    failureTitle: string,
  ): Promise<void> => {
    try {
      const message = await action();
      tasks.revalidate();
      await refreshMenuBar();
      await showToast({ style: Toast.Style.Success, title: message });
    } catch (error) {
      await showFailureToast(error, failureTitle);
    }
  };

  const remove = async (task: Task): Promise<void> => {
    const confirmed = await confirmAlert({
      title: `Delete "${task.name}"?`,
      message:
        "Entries tracked against it keep their time and become unfiled. This cannot be undone.",
      icon: Icon.Trash,
      primaryAction: { title: "Delete", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;

    await run(async () => {
      const api = await getTracktime();
      const result = await api.removeTask(task.id);
      return `Task deleted — ${describeRemoval(result)}`;
    }, "Could not delete the task");
  };

  const rows = tasks.data ?? [];

  return (
    <List
      isLoading={tasks.isLoading}
      navigationTitle={project.name}
      searchBarPlaceholder={`Search tasks in ${project.name}…`}
      actions={
        <ActionPanel>
          <Action.Push
            title="New Task…"
            icon={Icon.Plus}
            target={
              <TaskForm projectId={project.id} onSaved={tasks.revalidate} />
            }
          />
        </ActionPanel>
      }
    >
      <List.EmptyView
        icon={Icon.Circle}
        title="No tasks yet"
        description={`Nothing broken out inside ${project.name}.`}
        actions={
          <ActionPanel>
            <Action.Push
              title="New Task…"
              icon={Icon.Plus}
              target={
                <TaskForm projectId={project.id} onSaved={tasks.revalidate} />
              }
            />
          </ActionPanel>
        }
      />

      {rows.map((task) => (
        <List.Item
          key={task.id}
          icon={task.done ? Icon.CheckCircle : Icon.Circle}
          title={task.name}
          subtitle={task.archived ? "Archived" : undefined}
          accessories={
            task.totalSec > 0
              ? [
                  {
                    tag: {
                      value: formatDurationShort(task.totalSec),
                      color: Color.SecondaryText,
                    },
                  },
                ]
              : []
          }
          actions={
            <ActionPanel>
              <ActionPanel.Section>
                <Action
                  title="Start Timer on This Task"
                  icon={Icon.Play}
                  onAction={() =>
                    run(async () => {
                      const api = await getTracktime();
                      await api.start({
                        description: "",
                        projectId: project.id,
                        taskId: task.id,
                        billable: project.billableDefault,
                      });
                      return `Started — ${task.name}`;
                    }, "Could not start the timer")
                  }
                />
                <Action.Push
                  title="Edit Task…"
                  icon={Icon.Pencil}
                  shortcut={{ modifiers: ["cmd"], key: "e" }}
                  target={<TaskForm task={task} onSaved={tasks.revalidate} />}
                />
                <Action
                  title={task.done ? "Mark as Not Done" : "Mark as Done"}
                  icon={task.done ? Icon.Circle : Icon.CheckCircle}
                  shortcut={{ modifiers: ["cmd"], key: "d" }}
                  onAction={() =>
                    run(async () => {
                      const api = await getTracktime();
                      await api.updateTask({ id: task.id, done: !task.done });
                      return task.done ? "Marked not done" : "Marked done";
                    }, "Could not update the task")
                  }
                />
              </ActionPanel.Section>

              <ActionPanel.Section>
                <Action.Push
                  title="New Task…"
                  icon={Icon.Plus}
                  shortcut={{ modifiers: ["cmd"], key: "n" }}
                  target={
                    <TaskForm projectId={project.id} onSaved={tasks.revalidate} />
                  }
                />
                <Action
                  title={task.archived ? "Unarchive Task" : "Archive Task"}
                  icon={task.archived ? Icon.Tray : Icon.Box}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "a" }}
                  onAction={() =>
                    run(async () => {
                      const api = await getTracktime();
                      await api.archiveTask(task.id, !task.archived);
                      return task.archived ? "Task unarchived" : "Task archived";
                    }, "Could not archive the task")
                  }
                />
                <Action
                  title="Refresh"
                  icon={Icon.ArrowClockwise}
                  shortcut={{ modifiers: ["cmd"], key: "r" }}
                  onAction={tasks.revalidate}
                />
              </ActionPanel.Section>

              <ActionPanel.Section>
                <Action
                  title="Delete Task"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={{ modifiers: ["ctrl"], key: "x" }}
                  onAction={() => remove(task)}
                />
              </ActionPanel.Section>
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
