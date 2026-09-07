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
import { ProjectForm } from "./catalog/project-form.js";
import { TagForm } from "./catalog/tag-form.js";
import { TaskForm } from "./catalog/task-form.js";
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
  /** Undefined when the dropdown was not rendered — nothing to pick. */
  projectId?: string;
  taskId?: string;
  /** Undefined when the picker was not rendered — no tags exist yet. */
  tagIds?: string[];
  billable: boolean;
  start: Date | null;
  end: Date | null;
};

const orNull = (value: string | undefined): string | null =>
  value && value !== NONE ? value : null;

/**
 * Edit one entry. A running entry keeps running: its end stays empty, and
 * clearing the end of a finished entry deliberately puts it back to running,
 * which is the same contract the web app's editor has.
 */
export function EditEntry({ entry, onSaved }: Props): React.JSX.Element {
  const { pop } = useNavigation();
  const [projectId, setProjectId] = useState(entry.projectId ?? NONE);
  const [taskId, setTaskId] = useState(entry.taskId ?? NONE);
  const [tagIds, setTagIds] = useState<string[]>(entry.tagIds);
  const [submitting, setSubmitting] = useState(false);

  const projects = useApi("projects", (api) => api.projects());
  const tags = useApi("tags", (api) => api.tags());
  const tasks = useApi(
    `tasks:${projectId}`,
    (api) => (projectId === NONE ? Promise.resolve([]) : api.tasks(projectId)),
    { execute: projectId !== NONE },
  );

  // Dropping the project orphans the task — a task only exists inside one.
  useEffect(() => {
    if (projectId === NONE && taskId !== NONE) setTaskId(NONE);
  }, [projectId, taskId]);

  // Dropdowns render only when they have something to offer — see start-timer.
  const hasProjects = (projects.data ?? []).length > 0;
  const hasTasks = projectId !== NONE && (tasks.data ?? []).length > 0;
  const hasTags = (tags.data ?? []).length > 0;

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
        projectId: orNull(values.projectId),
        taskId: orNull(values.taskId),
        // Always sent, so clearing every tag in the picker actually clears
        // them rather than reading as "leave the tags alone".
        tagIds: values.tagIds ?? [],
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
      isLoading={
        projects.isLoading || tasks.isLoading || tags.isLoading || submitting
      }
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Entry"
            icon={Icon.Check}
            onSubmit={submit}
          />
          {/* Same reason as the start form: refiling an entry is exactly when
              you discover the project it belongs to was never created. */}
          <Action.Push
            title="New Project…"
            icon={Icon.Folder}
            shortcut={{ modifiers: ["cmd", "shift"], key: "p" }}
            target={
              <ProjectForm
                onSaved={(created) => {
                  setProjectId(created.id);
                  setTaskId(NONE);
                  projects.revalidate();
                }}
              />
            }
          />
          {projectId !== NONE ? (
            <Action.Push
              title="New Task…"
              icon={Icon.List}
              shortcut={{ modifiers: ["cmd", "shift"], key: "t" }}
              target={
                <TaskForm
                  projectId={projectId}
                  onSaved={(created) => {
                    setTaskId(created.id);
                    tasks.revalidate();
                  }}
                />
              }
            />
          ) : null}
          <Action.Push
            title="New Tag…"
            icon={Icon.Tag}
            shortcut={{ modifiers: ["cmd", "shift"], key: "g" }}
            target={
              <TagForm
                onSaved={(created) => {
                  setTagIds((current) => [...current, created.id]);
                  tags.revalidate();
                }}
              />
            }
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
      {hasProjects ? (
        <Form.Dropdown
          id="projectId"
          title="Project"
          value={projectId}
          onChange={(value) => {
            setProjectId(value);
            setTaskId(NONE);
          }}
        >
          <Form.Dropdown.Item
            value={NONE}
            title="No project"
            icon={Icon.Circle}
          />
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
      ) : null}
      {hasTasks ? (
        <Form.Dropdown
          id="taskId"
          title="Task"
          value={taskId}
          onChange={setTaskId}
        >
          <Form.Dropdown.Item value={NONE} title="No task" icon={Icon.Circle} />
          {(tasks.data ?? []).map((task) => (
            <Form.Dropdown.Item
              key={task.id}
              value={task.id}
              title={task.name}
            />
          ))}
        </Form.Dropdown>
      ) : null}
      {hasTags ? (
        <Form.TagPicker
          id="tagIds"
          title="Tags"
          value={tagIds}
          onChange={setTagIds}
        >
          {(tags.data ?? []).map((tag) => (
            <Form.TagPicker.Item
              key={tag.id}
              value={tag.id}
              title={tag.name}
              icon={{ source: Icon.CircleFilled, tintColor: tag.color }}
            />
          ))}
        </Form.TagPicker>
      ) : null}
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
