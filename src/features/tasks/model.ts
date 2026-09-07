import { z } from "zod";

/**
 * The stable record shape exposed by FocusDesk's native SQLite task store.
 * The UI depends on this contract rather than on the SQL row layout.
 */
export const TaskManagerPrioritySchema = z.enum(["low", "normal", "high"]);
export const TaskManagerStatusSchema = z.enum([
  "none",
  "in-progress",
  "ready-to-submit",
  "important",
]);

// SQLite represents booleans as 0/1. Accept those values at the web boundary
// so data returned by an older native build remains readable while the native
// bridge is upgraded to emit JSON booleans.
const TaskManagerBooleanSchema = z.preprocess((value) => {
  if (value === 0) return false;
  if (value === 1) return true;
  return value;
}, z.boolean());

export type TaskManagerStatus = z.infer<typeof TaskManagerStatusSchema>;

export const TASK_MANAGER_STATUS_LABELS: Record<TaskManagerStatus, string> = {
  none: "No status",
  "in-progress": "In Progress",
  "ready-to-submit": "Ready to Submit",
  important: "Important",
};

export const TaskManagerRecurrenceSchema = z
  .object({
    type: z.literal("weekly"),
    weekday: z.number().int().min(0).max(6).nullable().optional(),
    start: z.string().nullable().optional(),
    end: z.string().nullable().optional(),
  })
  .nullable();

export const TaskManagerTaskSchema = z.object({
  id: z.string().min(1),
  courseId: z.string().min(1),
  courseName: z.string().min(1),
  title: z.string(),
  weight: z.number(),
  deadline: z.string().datetime({ offset: true }).nullable(),
  completed: TaskManagerBooleanSchema,
  isExam: TaskManagerBooleanSchema,
  priority: TaskManagerPrioritySchema,
  status: TaskManagerStatusSchema.default("none"),
  recurrence: TaskManagerRecurrenceSchema,
  completedOccurrences: z.array(z.string()),
  occurrenceDate: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type TaskManagerTask = z.infer<typeof TaskManagerTaskSchema>;

/** The intentionally small task shape consumed by widget renderers. */
export const TaskManagerWidgetTaskSchema = z.object({
  id: z.string().min(1),
  courseCode: z.string().optional(),
  title: z.string(),
  done: z.boolean(),
  date: z.string(),
  time: z.string().optional(),
  priority: TaskManagerPrioritySchema.optional(),
});

export type TaskManagerWidgetTask = z.infer<typeof TaskManagerWidgetTaskSchema>;

export function taskManagerCourseCode(courseName: string): string {
  return courseName.split(/\s+-\s+/, 1)[0]?.trim() || courseName;
}

/**
 * Convert an ISO deadline into the date/time fields used by the existing
 * FocusDesk task widget. Recurring occurrences carry their own date and must
 * take precedence over the template deadline.
 */
export function taskManagerTaskToWidgetTask(
  task: TaskManagerTask,
): TaskManagerWidgetTask {
  const date = task.occurrenceDate ?? task.deadline?.slice(0, 10) ?? "";
  const time = task.deadline?.slice(11, 16);

  return {
    id: task.id,
    courseCode: taskManagerCourseCode(task.courseName),
    title: task.title,
    done: task.completed,
    date,
    ...(time && time !== "00:00" && /^\d{2}:\d{2}$/.test(time) ? { time } : {}),
    priority: task.priority,
  };
}

export function taskManagerTasksToWidgetTasks(
  tasks: readonly TaskManagerTask[],
): TaskManagerWidgetTask[] {
  return tasks.map(taskManagerTaskToWidgetTask);
}
