import {
  Action,
  ActionPanel,
  Form,
  Icon,
  Toast,
  popToRoot,
  showToast,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { ProjectForm } from "./components/catalog/project-form.js";
import { TagForm } from "./components/catalog/tag-form.js";
import { TaskForm } from "./components/catalog/task-form.js";
import { getTracktime } from "./lib/api.js";
import { formatDurationShort } from "./lib/format.js";
import { useApi } from "./lib/hooks.js";
import { webLink } from "./lib/preferences.js";
import { SignedOutView, refreshMenuBar, showFailureToast } from "./lib/ui.js";

/** `""` is the dropdown's stand-in for "no project"/"no task". */
const NONE = "";

type FormValues = {
  description: string;
  /** Undefined when the dropdown was not rendered — no projects to pick. */
  projectId?: string;
  taskId?: string;
  /** Undefined when the picker was not rendered — no tags exist yet. */
  tagIds?: string[];
  billable: boolean;
};

/** `""` and "field absent" both mean "unassigned" by the time this ships. */
const orNull = (value: string | undefined): string | null =>
  value && value !== NONE ? value : null;

export default function StartTimer(): React.JSX.Element {
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<string>(NONE);
  const [billable, setBillable] = useState(false);
  const [taskId, setTaskId] = useState<string>(NONE);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const projects = useApi("projects", (api) => api.projects());
  // Unscoped, unlike tasks: a tag belongs to the workspace, not to a project.
  const tags = useApi("tags", (api) => api.tags());
  const tasks = useApi(
    `tasks:${projectId}`,
    (api) => (projectId === NONE ? Promise.resolve([]) : api.tasks(projectId)),
    { execute: projectId !== NONE },
  );

  // A project carries its own billable default; respect it until the user
  // overrides the checkbox themselves.
  useEffect(() => {
    if (projectId === NONE) return;
    const project = projects.data?.find((candidate) => candidate.id === projectId);
    if (project) setBillable(project.billableDefault);
  }, [projectId, projects.data]);

  if (projects.signedOut) return <SignedOutView />;

  // A dropdown holding only its own "none" row is a dead control: it looks
  // interactive, opens onto nothing, and teaches the user not to trust it.
  // Both of these render only once they have something to offer.
  const hasProjects = (projects.data ?? []).length > 0;
  const hasTasks = projectId !== NONE && (tasks.data ?? []).length > 0;
  const hasTags = (tags.data ?? []).length > 0;

  const submit = async (values: FormValues): Promise<void> => {
    setSubmitting(true);
    try {
      const api = await getTracktime();
      const entry = await api.start({
        description: values.description.trim(),
        projectId: orNull(values.projectId),
        taskId: orNull(values.taskId),
        tagIds: values.tagIds ?? [],
        billable: values.billable,
      });
      await refreshMenuBar();
      await showToast({
        style: Toast.Style.Success,
        title: "Timer started",
        message: entry.description || "No description",
      });
      await popToRoot();
    } catch (error) {
      await showFailureToast(error, "Could not start the timer");
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
            title="Start Timer"
            icon={Icon.Play}
            onSubmit={submit}
          />
          {/* The thing you want to file under usually does not exist yet at
              the moment you go to file under it. Each of these pushes a form
              and comes back with the new row already selected, so a missing
              project is a detour rather than a dead end. */}
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
          <Action.OpenInBrowser
            title="Open Web App"
            url={webLink("/track")}
            shortcut={{ modifiers: ["cmd"], key: "o" }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="description"
        title="Description"
        placeholder="What are you working on?"
        value={description}
        onChange={setDescription}
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
              title={
                task.totalSec > 0
                  ? `${task.name} (${formatDurationShort(task.totalSec)})`
                  : task.name
              }
              icon={task.done ? Icon.CheckCircle : Icon.Circle}
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
          info="Tags cut across projects — an entry can carry several."
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
        value={billable}
        onChange={setBillable}
      />
      <Form.Description
        text={
          hasProjects
            ? "Starting a timer stops whatever is already running — tracktime keeps one timer at a time."
            : "No projects yet — this timer will be unassigned. Create projects in the web app to file time against them."
        }
      />
    </Form>
  );
}
