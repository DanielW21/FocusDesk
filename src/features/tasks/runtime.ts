import {
  createTaskManagerClient,
  type TaskManagerCourse,
} from "./tasks-client";
import {
  taskManagerTasksToWidgetTasks,
  type TaskManagerTask,
  type TaskManagerWidgetTask,
} from "./model";
import { createWeeklySummary } from "./weekly-summary";

export type TaskManagerRuntimeStatus =
  "loading" | "ready" | "unavailable" | "error";

export interface TaskManagerRuntimeSnapshot {
  status: TaskManagerRuntimeStatus;
  courses: TaskManagerCourse[];
  records: TaskManagerTask[];
  tasks: TaskManagerWidgetTask[];
  message?: string;
}

export const taskManagerRuntime: TaskManagerRuntimeSnapshot = {
  status: "unavailable",
  courses: [],
  records: [],
  tasks: [],
};

/**
 * Prepare dashboard records without mutating the database. Weekly templates
 * become dated occurrences so the Weekly View can treat them like ordinary
 * todos while completion still targets the original task plus occurrence date.
 */
export function taskManagerWidgetTasksFromRecords(
  records: readonly TaskManagerTask[],
  today = new Date(),
): TaskManagerWidgetTask[] {
  const summary = createWeeklySummary(records, today);
  const oneOffTasks = records.filter((task) => !task.recurrence);
  const recurringTasks = summary.weeks.flatMap((week) =>
    week.items
      .filter((item) => item.task.recurrence?.type === "weekly")
      .map(
        (item) =>
          taskManagerTasksToWidgetTasks([
            { ...item.task, occurrenceDate: item.occurrenceDate },
          ])[0]!,
      ),
  );
  return [
    ...taskManagerTasksToWidgetTasks(oneOffTasks),
    ...recurringTasks,
  ].sort((left, right) => {
    if (!left.date) return 1;
    if (!right.date) return -1;
    return (
      left.date.localeCompare(right.date) ||
      left.title.localeCompare(right.title)
    );
  });
}

export async function refreshTaskManagerRuntime(): Promise<TaskManagerRuntimeSnapshot> {
  taskManagerRuntime.status = "loading";
  taskManagerRuntime.message = undefined;
  try {
    const client = createTaskManagerClient();
    await client.health();
    const [records, courses] = await Promise.all([
      client.listTasks({ includeCompleted: true }),
      client.listCourses(),
    ]);
    taskManagerRuntime.courses = [...courses];
    taskManagerRuntime.records = [...records];
    taskManagerRuntime.tasks = taskManagerWidgetTasksFromRecords(records);
    taskManagerRuntime.status = "ready";
  } catch (error) {
    taskManagerRuntime.status = "unavailable";
    taskManagerRuntime.message =
      error instanceof Error
        ? error.message
        : "The FocusDesk task database could not be reached.";
  }
  return taskManagerRuntime;
}
