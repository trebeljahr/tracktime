import {
  Action,
  ActionPanel,
  Form,
  Icon,
  Toast,
  showToast,
  useNavigation,
} from "@raycast/api";
import type { Task } from "@starter/core";
import { useState } from "react";
import { getTracktime } from "../../lib/api.js";
import { useApi } from "../../lib/hooks.js";
import { NONE } from "../../lib/catalog.js";
import { showFailureToast } from "../../lib/ui.js";

type Props = {
  /** Absent creates; present edits that task. */
  task?: Task;
  /** Pre-selected project for a create. Editing cannot move a task. */
  projectId?: string;
  onSaved?: (task: Task) => void;
};

/**
 * Create or rename a task.
 *
 * A task belongs to exactly one project and the server has no "move" — so on
 * an edit the project is shown as fixed context rather than as a dropdown
 * that would look like it could be changed.
 */
export function TaskForm({
  task,
  projectId,
  onSaved,
}: Props): React.JSX.Element {
  const { pop } = useNavigation();
  const [name, setName] = useState(task?.name ?? "");
  const [nameError, setNameError] = useState<string | undefined>();
  const [selected, setSelected] = useState(
    task?.projectId ?? projectId ?? NONE,
  );
  const [done, setDone] = useState(task?.done ?? false);
  const [submitting, setSubmitting] = useState(false);

  const projects = useApi("projects", (api) => api.projects());
  const picking = task === undefined && projectId === undefined;

  const submit = async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed === "") {
      setNameError("Name is required");
      return;
    }
    if (!task && selected === NONE) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Pick a project",
        message: "A task always lives inside one.",
      });
      return;
    }

    setSubmitting(true);
    try {
      const api = await getTracktime();
      const saved = task
        ? await api.updateTask({ id: task.id, name: trimmed, done })
        : await api.createTask({ projectId: selected, name: trimmed });

      await showToast({
        style: Toast.Style.Success,
        title: task ? "Task saved" : "Task created",
        message: saved.name,
      });
      onSaved?.(saved);
      pop();
    } catch (error) {
      await showFailureToast(
        error,
        task ? "Could not save the task" : "Could not create the task",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const project = (projects.data ?? []).find(
    (candidate) => candidate.id === selected,
  );

  return (
    <Form
      isLoading={projects.isLoading || submitting}
      navigationTitle={task ? `Edit ${task.name}` : "New Task"}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={task ? "Save Task" : "Create Task"}
            icon={Icon.Check}
            onSubmit={submit}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="name"
        title="Name"
        placeholder="What is the piece of work?"
        value={name}
        error={nameError}
        onChange={(value) => {
          setName(value);
          if (nameError) setNameError(undefined);
        }}
      />
      {picking ? (
        <Form.Dropdown
          id="projectId"
          title="Project"
          value={selected}
          onChange={setSelected}
        >
          <Form.Dropdown.Item value={NONE} title="Pick a project" icon={Icon.Circle} />
          {(projects.data ?? []).map((candidate) => (
            <Form.Dropdown.Item
              key={candidate.id}
              value={candidate.id}
              title={
                candidate.clientName
                  ? `${candidate.name} — ${candidate.clientName}`
                  : candidate.name
              }
              icon={{ source: Icon.CircleFilled, tintColor: candidate.color }}
            />
          ))}
        </Form.Dropdown>
      ) : (
        <Form.Description
          title="Project"
          text={project?.name ?? "This task's project"}
        />
      )}
      {task ? (
        <Form.Checkbox
          id="done"
          label="Done"
          value={done}
          onChange={setDone}
          info="A done task stays selectable — it only sorts and renders differently."
        />
      ) : null}
    </Form>
  );
}
