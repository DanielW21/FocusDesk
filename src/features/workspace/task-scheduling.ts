/** A recurrence rule for a task that has a scheduled occurrence. */
export interface TaskRecurrence {
  type: "daily" | "weekly";
  /** JavaScript weekday numbers: Sunday is 0 and Saturday is 6. */
  weekdays: number[];
  start: string;
  end: string | null;
}

/** The scheduling fields needed by the task list and widgets. */
export interface TaskSchedulingTask {
  /** The original date for a one-time task; ignored for recurring tasks. */
  date: string;
  recurrence: TaskRecurrence | null;
  /** Per-occurrence completion dates for recurring tasks. */
  completedDates: string[];
  /** Completion state for a one-time task. */
  done?: boolean;
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function dateKeyToDate(date: string): Date | undefined {
  if (!DATE_KEY_PATTERN.test(date)) return undefined;

  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const parsed = new Date(0);
  parsed.setUTCHours(0, 0, 0, 0);
  parsed.setUTCFullYear(year, month - 1, day);

  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? parsed
    : undefined;
}

function isValidWeekdays(weekdays: unknown): weekdays is number[] {
  return (
    Array.isArray(weekdays) &&
    weekdays.length > 0 &&
    weekdays.every(
      (weekday) => Number.isInteger(weekday) && weekday >= 0 && weekday <= 6,
    )
  );
}

function cloneRecurrence(
  recurrence: TaskRecurrence | null,
): TaskRecurrence | null {
  return recurrence
    ? { ...recurrence, weekdays: [...recurrence.weekdays] }
    : null;
}

/** Returns true when the task has a recurrence rule rather than one date. */
export function isRecurringTask(task: TaskSchedulingTask): boolean {
  return task.recurrence !== null;
}

/**
 * Returns whether a task has an occurrence scheduled for the supplied local
 * YYYY-MM-DD date. One-time tasks remain scheduled after their original date
 * so an unfinished task can carry over into later daily views.
 */
export function isTaskScheduledOnDate(
  task: TaskSchedulingTask,
  date: string,
): boolean {
  if (!dateKeyToDate(date)) return false;

  if (!task.recurrence) {
    return Boolean(dateKeyToDate(task.date)) && date >= task.date;
  }

  const { recurrence } = task;
  if (!dateKeyToDate(recurrence.start)) return false;
  if (recurrence.end !== null && !dateKeyToDate(recurrence.end)) {
    return false;
  }
  if (date < recurrence.start) return false;
  if (recurrence.end !== null && date > recurrence.end) return false;

  if (recurrence.type === "daily") return true;
  if (recurrence.type !== "weekly" || !isValidWeekdays(recurrence.weekdays)) {
    return false;
  }

  return recurrence.weekdays.includes(dateKeyToDate(date)!.getUTCDay());
}

/**
 * Returns whether the task is completed for this date. A one-time task has a
 * single completion state; recurring tasks use independent completion dates.
 */
export function isTaskCompletedOnDate(
  task: TaskSchedulingTask,
  date: string,
): boolean {
  if (!dateKeyToDate(date)) return false;
  if (!task.recurrence) return task.done === true;
  return (
    Array.isArray(task.completedDates) && task.completedDates.includes(date)
  );
}

/** Returns whether an occurrence should appear in an open task view. */
export function isTaskVisibleOnDate(
  task: TaskSchedulingTask,
  date: string,
): boolean {
  return (
    isTaskScheduledOnDate(task, date) && !isTaskCompletedOnDate(task, date)
  );
}

/**
 * Returns true only for an unfinished one-time task appearing after its
 * original date. The original date itself is not considered carry-over.
 */
export function isOneTimeCarryOverTask(
  task: TaskSchedulingTask,
  date: string,
): boolean {
  return (
    !isRecurringTask(task) &&
    task.done !== true &&
    Boolean(dateKeyToDate(task.date)) &&
    Boolean(dateKeyToDate(date)) &&
    date > task.date
  );
}

/**
 * Marks or unmarks one recurring occurrence without mutating the task, its
 * recurrence rule, or its completion-date array. One-time tasks are returned
 * as a defensive copy because this helper only applies to recurring tasks.
 */
export function setRecurringOccurrenceCompleted(
  task: TaskSchedulingTask,
  date: string,
  completed: boolean,
): TaskSchedulingTask {
  const currentDates = Array.isArray(task.completedDates)
    ? task.completedDates
    : [];
  const nextDates =
    !isRecurringTask(task) || !dateKeyToDate(date)
      ? [...currentDates]
      : completed
        ? [...new Set([...currentDates, date])]
        : currentDates.filter((completedDate) => completedDate !== date);

  return {
    ...task,
    recurrence: cloneRecurrence(task.recurrence),
    completedDates: nextDates,
  };
}
