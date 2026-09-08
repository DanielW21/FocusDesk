import { z } from "zod";
import {
  isRecurringTask as scheduleIsRecurringTask,
  isTaskCompletedOnDate as scheduleIsTaskCompletedOnDate,
  isTaskScheduledOnDate as scheduleIsTaskScheduledOnDate,
  isTaskVisibleOnDate as scheduleIsTaskVisibleOnDate,
  setRecurringOccurrenceCompleted,
  type TaskRecurrence as ScheduledTaskRecurrence,
  type TaskSchedulingTask,
} from "./task-scheduling";

export type Priority = "low" | "normal" | "high";

export type TaskRecurrence = ScheduledTaskRecurrence;
export type TaskRecurrenceType = TaskRecurrence["type"];

export interface Task {
  id: number;
  title: string;
  done: boolean;
  tag: string;
  date: string;
  time?: string;
  priority?: Priority;
  /** Optional on input so old persisted tasks remain assignable. */
  recurrence?: TaskRecurrence | null;
  /** Optional on input so old persisted tasks remain assignable. */
  completedDates?: string[];
}

export type CalendarEventSource = "focusdesk" | "google" | "ics";
export type CalendarEventSyncStatus = "pending" | "synced" | "error";

export interface CalendarEvent {
  id: number;
  title: string;
  date: string;
  time?: string;
  calendar?: string;
  source?: CalendarEventSource;
  googleCalendarId?: string;
  googleEventId?: string;
  googleICalUID?: string;
  googleETag?: string;
  googleUpdatedAt?: string;
  syncStatus?: CalendarEventSyncStatus;
  syncError?: string;
}

export interface Note {
  id: number;
  title: string;
  body: string;
  date: string;
}

export interface QuickLink {
  id: number;
  title: string;
  url: string;
  description?: string;
  asset?: string;
  color?: string;
}

const DateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must use YYYY-MM-DD format");

const LegacyBooleanSchema = z.preprocess((value) => {
  if (value === 0 || value === "0") return false;
  if (value === 1 || value === "1") return true;
  return value;
}, z.boolean());

export const TaskRecurrenceSchema = z.object({
  type: z.enum(["daily", "weekly"]),
  weekdays: z.array(z.number().int().min(0).max(6)).default([]),
  start: DateStringSchema,
  end: DateStringSchema.nullable().default(null),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeTaskInput(value: unknown): unknown {
  if (!isRecord(value)) return value;

  const normalized = { ...value };
  if ("done" in normalized) {
    normalized.done =
      normalized.done === 0 || normalized.done === "0"
        ? false
        : normalized.done === 1 || normalized.done === "1"
          ? true
          : normalized.done;
  }

  if (!("completedDates" in normalized) && "completedOccurrences" in normalized)
    normalized.completedDates = normalized.completedOccurrences;

  if (normalized.recurrence && isRecord(normalized.recurrence)) {
    const recurrence = { ...normalized.recurrence };
    if (!("weekdays" in recurrence) && typeof recurrence.weekday === "number")
      recurrence.weekdays = [recurrence.weekday];
    if (!("start" in recurrence) && typeof normalized.date === "string")
      recurrence.start = normalized.date;
    if (!("end" in recurrence)) recurrence.end = null;
    normalized.recurrence = recurrence;
  } else if (!("recurrence" in normalized)) {
    normalized.recurrence = null;
  }

  return normalized;
}

const TaskRecordSchema = z.object({
  id: z.number(),
  title: z.string(),
  done: LegacyBooleanSchema,
  tag: z.string(),
  date: DateStringSchema,
  time: z.string().optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  recurrence: z
    .preprocess(
      (value) => (value === undefined ? null : value),
      TaskRecurrenceSchema.nullable(),
    )
    .default(null),
  completedDates: z.array(DateStringSchema).default([]),
});

/**
 * The native bridge has historically returned SQLite booleans as 0/1. Keep
 * that compatibility at the boundary, then validate the normalized record.
 */
export const TaskSchema = z.preprocess(normalizeTaskInput, TaskRecordSchema);

function schedulingTask(task: Task): TaskSchedulingTask {
  return {
    ...task,
    recurrence: task.recurrence ?? null,
    completedDates: task.completedDates ?? [],
  };
}

export function taskIsRecurring(task: Task): boolean {
  return scheduleIsRecurringTask(schedulingTask(task));
}

export function taskIsDueOnDate(task: Task, date: string): boolean {
  return scheduleIsTaskScheduledOnDate(schedulingTask(task), date);
}

export function taskIsCompletedOnDate(task: Task, date: string): boolean {
  return scheduleIsTaskCompletedOnDate(schedulingTask(task), date);
}

export function taskIsOpenOnDate(task: Task, date: string): boolean {
  return scheduleIsTaskVisibleOnDate(schedulingTask(task), date);
}

export function toggleTaskOnDate(task: Task, date: string): Task {
  if (!taskIsRecurring(task)) return { ...task, done: !task.done };
  const updated = setRecurringOccurrenceCompleted(
    schedulingTask(task),
    date,
    !taskIsCompletedOnDate(task, date),
  );
  return {
    ...task,
    done: false,
    recurrence: updated.recurrence,
    completedDates: updated.completedDates,
  };
}

export const CalendarEventSchema = z.object({
  id: z.number(),
  title: z.string(),
  date: z.string(),
  time: z.string().optional(),
  calendar: z.string().optional(),
  source: z.enum(["focusdesk", "google", "ics"]).optional(),
  googleCalendarId: z.string().optional(),
  googleEventId: z.string().optional(),
  googleICalUID: z.string().optional(),
  googleETag: z.string().optional(),
  googleUpdatedAt: z.string().optional(),
  syncStatus: z.enum(["pending", "synced", "error"]).optional(),
  syncError: z.string().optional(),
});

export const NoteSchema = z.object({
  id: z.number(),
  title: z.string(),
  body: z.string(),
  date: z.string(),
});

export const QuickLinkSchema = z.object({
  id: z.number(),
  title: z.string(),
  url: z.string(),
  description: z.string().optional(),
  asset: z.string().optional(),
  color: z.string().optional(),
});

export const WorkspaceWidgetDataSchema = z.object({
  tasks: z.array(TaskSchema),
  events: z.array(CalendarEventSchema),
  notes: z.array(NoteSchema),
  links: z.array(QuickLinkSchema),
  selectedDate: z.string(),
  focusDurationMinutes: z.number().int().min(5).max(120).optional(),
});
export type WorkspaceWidgetData = z.infer<typeof WorkspaceWidgetDataSchema>;
