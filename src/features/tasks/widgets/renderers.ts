import { z } from "zod";

import type {
  WidgetDimension,
  WidgetRenderContext,
} from "../../../contracts/widgets";
import { TaskManagerWidgetTaskSchema } from "../model";
import { dimensionParts, visualRows } from "../../../widgets/widget-dimensions";

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

export function renderTaskManager(
  context: WidgetRenderContext,
  dimension: WidgetDimension,
): string {
  const data = TaskManagerWidgetDataSchema.parse(context.data).taskManager;
  if (data.status === "loading") {
    return '<div class="integration-state"><strong>Loading tasks…</strong><span>Connecting to TaskManager</span></div>';
  }
  if (data.status !== "ready") {
    return `<div class="integration-state"><strong>${data.status === "unavailable" ? "Task database unavailable" : "Task database needs attention"}</strong><span>${escapeHtml(data.message ?? "FocusDesk could not read its SQLite task database.")}</span></div>`;
  }

  const rows = visualRows(dimension);
  const columns = dimensionParts(dimension).columns;
  const expanded = context.settings.taskManagerExpanded === true;
  const openTasks = data.tasks.filter((task) => !task.done);
  const weekTasks = openTasks.filter((task) => isDueThisWeek(task.date));
  const upcomingTasks = openTasks.filter((task) => isUpcoming(task.date));
  const visibleLimit = rows <= 1 ? 1 : rows >= 3 ? 8 : columns >= 4 ? 6 : 4;
  const renderTask = (task: (typeof openTasks)[number]) =>
    `<div><i class="${task.priority ?? "normal"}"></i><span>${escapeHtml(`${task.courseCode ?? "Task"} - ${task.title}`)}</span><small>${escapeHtml(formatTaskDate(task.date, task.time))}</small></div>`;

  let content: string;
  let hiddenTaskCount: number;
  if (expanded) {
    const visibleTasks = openTasks;
    content = visibleTasks.length
      ? visibleTasks.map(renderTask).join("")
      : '<div class="integration-state"><strong>All clear</strong><span>No open TaskManager tasks.</span></div>';
    hiddenTaskCount = openTasks.length - visibleTasks.length;
  } else {
    const visibleWeekTasks = weekTasks.slice(0, visibleLimit);
    const upcomingLimit = Math.max(
      0,
      visibleLimit - visibleWeekTasks.length - 1,
    );
    const visibleUpcomingTasks = upcomingTasks.slice(0, upcomingLimit);
    const weekContent = weekTasks.length
      ? visibleWeekTasks.map(renderTask).join("")
      : '<div class="task-manager-week-empty"><strong>All done for the week!</strong></div>';
    const upcomingContent = visibleUpcomingTasks.length
      ? `<div class="task-manager-section-label">Upcoming</div>${visibleUpcomingTasks.map(renderTask).join("")}`
      : "";
    content = weekContent + upcomingContent;
    hiddenTaskCount =
      weekTasks.length -
      visibleWeekTasks.length +
      upcomingTasks.length -
      visibleUpcomingTasks.length;
  }
  const footerLabel = expanded
    ? `${openTasks.length} open`
    : `${weekTasks.length} due this week`;
  const moreLabel =
    hiddenTaskCount > 0 ? `View more (${hiddenTaskCount}) ↗` : "TaskManager";
  return `<div class="bubble-task-list">${content}</div><div class="widget-foot">${footerLabel} <span>${moreLabel}</span></div>`;
}
