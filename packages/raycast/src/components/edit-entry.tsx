import {
  Action,
  ActionPanel,
  Form,
  Icon,
  Toast,
  showToast,
  useNavigation,
} from "@raycast/api";
import type { DetailedEntry } from "@starter/core";
import { useEffect, useState } from "react";
import { getTracktime } from "../lib/api.js";
import { useApi } from "../lib/hooks.js";
import { refreshMenuBar, showFailureToast } from "../lib/ui.js";

const NONE = "";

type Props = {
  entry: DetailedEntry;
  /** Called after a successful save, so the list can revalidate. */
  onSaved: () => void;
};

type FormValues = {
  description: string;
  projectId: string;
  taskId: string;
  billable: boolean;
  start: Date | null;
  end: Date | null;
};

/**
 * Edit one entry. A running entry keeps running: its end stays empty, and
 * clearing the end of a finished entry deliberately puts it back to running,
 * which is the same contract the web app's editor has.
 */
export function EditEntry({ entry, onSaved }: Props): React.JSX.Element {
  const { pop } = useNavigation();
  const [projectId, setProjectId] = useState(entry.projectId ?? NONE);
  const [taskId, setTaskId] = useState(entry.taskId ?? NONE);
  const [submitting, setSubmitting] = useState(false);

  const projects = useApi("projects", (api) => api.projects());
  const tasks = useApi(
    `tasks:${projectId}`,
    (api) => (projectId === NONE ? Promise.resolve([]) : api.tasks(projectId)),
    { execute: projectId !== NONE },
  );

  // Dropping the project orphans the task — a task only exists inside one.
  useEffect(() => {
    if (projectId === NONE && taskId !== NONE) setTaskId(NONE);
  }, [projectId, taskId]);

  const submit = async (values: FormValues): Promise<void> => {
    if (values.start && values.end && values.end <= values.start) {
      await showToast({
        style: Toast.Style.Failure,
        title: "End must be after start",
      });
      return;
    }

    setSubmitting(true);
    try {
      const api = await getTracktime();
      await api.update({
        id: entry.id,
        description: values.description.trim(),
        projectId: values.projectId === NONE ? null : values.projectId,
        taskId: values.taskId === NONE ? null : values.taskId,
        billable: values.billable,
        start: (values.start ?? new Date(entry.start)).toISOString(),
        end: values.end ? values.end.toISOString() : null,
      });
      await refreshMenuBar();
      await showToast({ style: Toast.Style.Success, title: "Entry saved" });
      onSaved();
      pop();
    } catch (error) {
      await showFailureToast(error, "Could not save the entry");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Form
      isLoading={projects.isLoading || tasks.isLoading || submitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Entry"
            icon={Icon.Check}
            onSubmit={submit}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="description"
        title="Description"
        placeholder="What did you work on?"
        defaultValue={entry.description}
      />
      <Form.Dropdown
        id="projectId"
        title="Project"
        value={projectId}
        onChange={(value) => {
          setProjectId(value);
          setTaskId(NONE);
        }}
      >
        <Form.Dropdown.Item value={NONE} title="No project" icon={Icon.Circle} />
        {(projects.data ?? []).map((project) => (
          <Form.Dropdown.Item
            key={project.id}
            value={project.id}
            title={
              project.clientName
                ? `${project.name} — ${project.clientName}`
                : project.name
            }
            icon={{ source: Icon.CircleFilled, tintColor: project.color }}
          />
        ))}
      </Form.Dropdown>
      <Form.Dropdown id="taskId" title="Task" value={taskId} onChange={setTaskId}>
        <Form.Dropdown.Item value={NONE} title="No task" icon={Icon.Circle} />
        {(tasks.data ?? []).map((task) => (
          <Form.Dropdown.Item key={task.id} value={task.id} title={task.name} />
        ))}
      </Form.Dropdown>
      <Form.Checkbox
        id="billable"
        label="Billable"
        defaultValue={entry.billable}
      />
      <Form.DatePicker
        id="start"
        title="Start"
        type={Form.DatePicker.Type.DateTime}
        defaultValue={new Date(entry.start)}
      />
      <Form.DatePicker
        id="end"
        title="End"
        type={Form.DatePicker.Type.DateTime}
        defaultValue={entry.end ? new Date(entry.end) : null}
        info="Leave empty to keep the timer running."
      />
    </Form>
  );
}
