import {
  Action,
  ActionPanel,
  Form,
  Icon,
  LaunchProps,
  Toast,
  popToRoot,
  showToast,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { getTracktime } from "./lib/api.js";
import { formatDurationShort } from "./lib/format.js";
import { useApi } from "./lib/hooks.js";
import { webLink } from "./lib/preferences.js";
import { SignedOutView, refreshMenuBar, showFailureToast } from "./lib/ui.js";

/** `""` is the dropdown's stand-in for "no project"/"no task". */
const NONE = "";

type FormValues = {
  description: string;
  projectId: string;
  taskId: string;
  billable: boolean;
};

export default function StartTimer(
  props: LaunchProps<{ arguments: Arguments.StartTimer }>,
): React.JSX.Element {
  const [description, setDescription] = useState(
    props.arguments?.description ?? "",
  );
  const [projectId, setProjectId] = useState<string>(NONE);
  const [billable, setBillable] = useState(false);
  const [taskId, setTaskId] = useState<string>(NONE);
  const [submitting, setSubmitting] = useState(false);

  const projects = useApi("projects", (api) => api.projects());
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

  const submit = async (values: FormValues): Promise<void> => {
    setSubmitting(true);
    try {
      const api = await getTracktime();
      const entry = await api.start({
        description: values.description.trim(),
        projectId: values.projectId === NONE ? null : values.projectId,
        taskId: values.taskId === NONE ? null : values.taskId,
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
      isLoading={projects.isLoading || tasks.isLoading || submitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Start Timer"
            icon={Icon.Play}
            onSubmit={submit}
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
      <Form.Dropdown
        id="taskId"
        title="Task"
        value={taskId}
        onChange={setTaskId}
        info={
          projectId === NONE
            ? "Pick a project first — tasks belong to a project."
            : undefined
        }
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
      <Form.Checkbox
        id="billable"
        label="Billable"
        value={billable}
        onChange={setBillable}
      />
      <Form.Description text="Starting a timer stops whatever is already running — tracktime keeps one timer at a time." />
    </Form>
  );
}
