import { z } from "zod";

import type {
  WidgetDimension,
  WidgetRenderContext,
} from "../../../contracts/widgets";
import {
  TaskManagerWidgetTaskSchema,
  type TaskManagerWidgetTask,
} from "../model";

const TaskManagerWidgetDataSchema = z.object({
  taskManager: z.object({
    status: z.enum(["loading", "ready", "unavailable", "error"]),
    tasks: z.array(TaskManagerWidgetTaskSchema),
    message: z.string().optional(),
  }),
});

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character] ?? character,
  );
}

function formatTaskDate(date: string, time?: string): string {
  const formattedTime = time ? formatTaskTime(time) : undefined;
  if (!date) return formattedTime ? `No date · ${formattedTime}` : "No date";

  const parsed = new Date(`${date}T12:00:00`);
  const label = Number.isNaN(parsed.getTime())
    ? date
    : new Intl.DateTimeFormat("en-CA", {
        month: "short",
        day: "numeric",
      }).format(parsed);

  return formattedTime ? `${label} · ${formattedTime}` : label;
}

function formatTaskTime(time: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return time;
  const hour = Number(match[1]);
  const minute = match[2];
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return time;
  const meridiem = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${meridiem}`;
}

function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isDueThisWeek(date: string): boolean {
  if (!date) return false;
  const today = new Date();
  const firstDay = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - today.getDay(),
  );
  const lastDay = new Date(
    firstDay.getFullYear(),
    firstDay.getMonth(),
    firstDay.getDate(),
  );
  lastDay.setDate(firstDay.getDate() + 6);
  return date >= localDateString(firstDay) && date <= localDateString(lastDay);
}

function isUpcoming(date: string): boolean {
  if (!date) return false;
  const today = new Date();
  const firstDay = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - today.getDay(),
  );
  const lastDay = new Date(
    firstDay.getFullYear(),
    firstDay.getMonth(),
    firstDay.getDate(),
  );
  lastDay.setDate(firstDay.getDate() + 6);
  return date > localDateString(lastDay);
}

function weekStartFor(date: string): string | undefined {
  if (!date) return undefined;
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  parsed.setDate(parsed.getDate() - parsed.getDay());
  return localDateString(parsed);
}

function formatWeekRange(weekStart: string): string {
  const start = new Date(`${weekStart}T12:00:00`);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const formatter = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  });
  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

function renderWeeklyTaskManager(
  tasks: readonly TaskManagerWidgetTask[],
  renderTask: (task: TaskManagerWidgetTask) => string,
): string {
  const weeks = new Map<string, TaskManagerWidgetTask[]>();
  const unscheduled: TaskManagerWidgetTask[] = [];
  for (const task of tasks) {
    const weekStart = weekStartFor(task.date);
    if (!weekStart) {
      unscheduled.push(task);
      continue;
    }
    const weekTasks = weeks.get(weekStart) ?? [];
    weekTasks.push(task);
    weeks.set(weekStart, weekTasks);
  }

  const sections = [...weeks.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([weekStart, weekTasks], index) =>
        `<section class="task-manager-widget-week"><header><div><span>${index === 0 ? "Up next" : "Week"}</span><strong>${formatWeekRange(weekStart)}</strong></div><b>${weekTasks.length} ${weekTasks.length === 1 ? "todo" : "todos"}</b></header>${weekTasks.map(renderTask).join("")}</section>`,
    );
  if (unscheduled.length) {
    sections.push(
      `<section class="task-manager-widget-week"><header><div><span>Anytime</span><strong>No date yet</strong></div><b>${unscheduled.length} ${unscheduled.length === 1 ? "todo" : "todos"}</b></header>${unscheduled.map(renderTask).join("")}</section>`,
    );
  }
  return sections.length
    ? `<div class="task-manager-widget-weeks">${sections.join("")}</div>`
    : '<div class="integration-state"><strong>All clear</strong><span>No open TaskManager tasks.</span></div>';
}

export function renderTaskManager(
  context: WidgetRenderContext,
  dimension: WidgetDimension = "2x2",
): string {
  const data = TaskManagerWidgetDataSchema.parse(context.data).taskManager;
  if (data.status === "loading") {
    return '<div class="integration-state"><strong>Loading tasks…</strong><span>Connecting to TaskManager</span></div>';
  }
  if (data.status !== "ready") {
    return `<div class="integration-state"><strong>${data.status === "unavailable" ? "Task database unavailable" : "Task database needs attention"}</strong><span>${escapeHtml(data.message ?? "FocusDesk could not read its SQLite task database.")}</span></div>`;
  }

  const expanded = context.settings.taskManagerExpanded === true;
  const openTasks = data.tasks.filter((task) => !task.done);
  const weekTasks = openTasks.filter((task) => isDueThisWeek(task.date));
  const upcomingTasks = openTasks.filter((task) => isUpcoming(task.date));
  const renderTask = (task: (typeof openTasks)[number]) =>
    `<div class="task-manager-widget-task"><i class="${task.priority ?? "normal"}"></i><span>${escapeHtml(`${task.courseCode ?? "Task"} - ${task.title}`)}</span><small>${escapeHtml(formatTaskDate(task.date, task.time))}</small></div>`;

  if (dimension === "4x3" && !expanded) {
    return `<div class="bubble-task-list">${renderWeeklyTaskManager(openTasks, renderTask)}</div><div class="widget-foot">${openTasks.length} open <span>Scroll for more</span></div>`;
  }

  let content: string;
  if (expanded) {
    const visibleTasks = openTasks;
    content = visibleTasks.length
      ? visibleTasks.map(renderTask).join("")
      : '<div class="integration-state"><strong>All clear</strong><span>No open TaskManager tasks.</span></div>';
  } else {
    const weekContent = weekTasks.length
      ? weekTasks.map(renderTask).join("")
      : '<div class="task-manager-week-empty"><strong>All done for the week!</strong></div>';
    const upcomingContent = upcomingTasks.length
      ? `<div class="task-manager-section-label">Upcoming</div>${upcomingTasks.map(renderTask).join("")}`
      : "";
    content = weekContent + upcomingContent;
  }
  const footerLabel = expanded
    ? `${openTasks.length} open`
    : `${weekTasks.length} due this week`;
  return `<div class="bubble-task-list">${content}</div><div class="widget-foot">${footerLabel} <span>${expanded ? "TaskManager" : "Scroll for more"}</span></div>`;
}
