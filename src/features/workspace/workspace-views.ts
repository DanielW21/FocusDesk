import type { AppState, TaskFilter } from "../../app/app-state";
import type { CalendarEvent, Task } from "./model";
import type { GoogleCalendarSummary } from "./google-calendar-client";
import {
  quickLinkAccessibleLabel,
  quickLinkHoverText,
  quickLinkType,
  renderQuickLinkAsset,
} from "./quick-links";
import { escapeHtml, formatShort, localDate } from "../../ui/formatters";

export interface WorkspaceViewContext {
  state: AppState;
  now: Date;
  selectedDate: string;
  calendarDate: Date;
  taskFilter: TaskFilter;
  focusDeskTaskStorageMessage: string;
  isVisibleCalendarEvent: (event: CalendarEvent) => boolean;
  googleCalendarCalendars: GoogleCalendarSummary[];
}

export function renderTaskList(tasks: Task[], selectedDate: string): string {
  if (!tasks.length)
    return '<div class="empty"><span class="empty-icon">✓</span>Nothing here yet. Enjoy the breathing room.</div>';
  return `<div class="task-list">${tasks
    .map(
      (task) =>
        `<div class="task ${task.done ? "done" : ""}" data-id="${task.id}">
      <button class="check" data-action="toggle-task" aria-label="Toggle task">${task.done ? "✓" : ""}</button>
      <span class="priority-dot ${task.priority ?? "normal"}"></span>
      <button class="task-title" data-action="edit-task">${escapeHtml(task.title)}</button>
      <span class="tag">${escapeHtml(task.tag || "Task")}</span>
      <span class="task-time">${task.date === selectedDate ? task.time || "" : formatShort(task.date)}</span>
      <button class="delete" data-action="delete-task" aria-label="Delete task">×</button>
    </div>`,
    )
    .join("")}</div>`;
}

export function renderTasksView(context: WorkspaceViewContext): string {
  const tasks = context.state.tasks
    .filter((task) =>
      context.taskFilter === "active"
        ? !task.done
        : context.taskFilter === "done"
          ? task.done
          : true,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  return `<div class="view-wrap">
    <div class="title-row"><div><p class="eyebrow">Everything in one place</p><h1>All tasks</h1><p class="date-line">${context.state.tasks.filter((task) => !task.done).length} things still in motion</p></div><button class="primary-button" data-action="add-task">＋ Add task</button></div>
    ${context.focusDeskTaskStorageMessage ? `<div class="integration-state"><strong>Task database unavailable</strong><span>${escapeHtml(context.focusDeskTaskStorageMessage)}</span></div>` : ""}
    <div class="filter-row">${(["all", "active", "done"] as TaskFilter[]).map((filter) => `<button class="filter ${context.taskFilter === filter ? "active" : ""}" data-filter="${filter}">${{ all: "All tasks", active: "Open", done: "Completed" }[filter]}</button>`).join("")}</div>
    <div class="panel">${renderTaskList(tasks, context.selectedDate)}</div>
  </div>`;
}

function googleCalendarColor(calendar: GoogleCalendarSummary): string {
  return /^#[0-9a-f]{6}$/i.test(calendar.backgroundColor ?? "")
    ? calendar.backgroundColor!
    : "#789080";
}

const GOOGLE_CALENDAR_FALLBACK_COLORS = [
  "#4b8fd8",
  "#d96f4e",
  "#63b37c",
  "#9a72c8",
  "#d29a3a",
  "#5ba9a4",
];

function calendarEventStyle(
  event: CalendarEvent,
  calendars: GoogleCalendarSummary[],
): string {
  if (event.source !== "google" || !event.googleCalendarId) return "";
  const calendar = calendars.find((item) => item.id === event.googleCalendarId);
  let color = calendar ? googleCalendarColor(calendar) : undefined;
  if (!color) {
    let hash = 0;
    for (const character of event.googleCalendarId) {
      hash = (hash * 31 + character.charCodeAt(0)) | 0;
    }
    color =
      GOOGLE_CALENDAR_FALLBACK_COLORS[
        Math.abs(hash) % GOOGLE_CALENDAR_FALLBACK_COLORS.length
      ];
  }
  return color ? ` style="--calendar-event-color:${color}"` : "";
}

export function renderEventsFor(
  date: string,
  context: WorkspaceViewContext,
): string {
  return context.state.events
    .filter(
      (event) => event.date === date && context.isVisibleCalendarEvent(event),
    )
    .map(
      (event) =>
        `<div class="event ${event.source === "focusdesk" ? "event-editable" : ""} ${event.source === "google" ? "google-event" : ""}"${calendarEventStyle(event, context.googleCalendarCalendars)} ${event.source === "focusdesk" ? `data-action="edit-calendar-event" data-id="${event.id}" role="button" tabindex="0"` : ""}><div class="event-time">${escapeHtml(event.time || "ALL DAY")}</div><div class="event-body"><div class="event-title">${escapeHtml(event.title)}</div><div class="event-sub">${escapeHtml(event.calendar || (event.source === "google" ? "Google Calendar" : "Imported calendar"))}${event.source === "focusdesk" ? " · editable" : " · read-only"}</div></div></div>`,
    )
    .join("");
}

export function renderCalendarView(context: WorkspaceViewContext): string {
  const year = context.calendarDate.getFullYear();
  const month = context.calendarDate.getMonth();
  const days = new Date(year, month + 1, 0).getDate();
  const start = new Date(year, month, 1).getDay();
  let cells = '<div class="day-cell muted-cell"></div>'.repeat(start);
  for (let day = 1; day <= days; day += 1) {
    const date = localDate(new Date(year, month, day));
    const events = context.state.events.filter(
      (event) => event.date === date && context.isVisibleCalendarEvent(event),
    );
    const tasks = context.state.tasks.filter((task) => task.date === date);
    cells += `<div class="day-cell ${date === localDate(context.now) ? "today-cell" : ""}"><button class="day-num ${date === localDate(context.now) ? "today-num" : ""}" data-action="select-date" data-date="${date}">${day}</button>${events.map((event) => `<div class="cal-event ${event.source === "focusdesk" ? "focusdesk-event" : "google-event"}"${calendarEventStyle(event, context.googleCalendarCalendars)} ${event.source === "focusdesk" ? `data-action="edit-calendar-event" data-id="${event.id}" role="button" tabindex="0" title="Edit ${escapeHtml(event.title)}"` : `title="${escapeHtml(event.title)} · read-only"`}>${escapeHtml(event.title)}</div>`).join("")}${tasks.map((task) => `<div class="cal-event task-event">${task.done ? "✓ " : ""}${escapeHtml(task.title)}</div>`).join("")}</div>`;
  }
  return `<div class="view-wrap"><div class="title-row"><div><p class="eyebrow">Plan with perspective</p><h1>Calendar</h1><p class="date-line">Google events are read-only. FocusDesk events can be added and edited here.</p></div><div class="calendar-tools"><button class="secondary-button" data-action="import-ics">＋ Import .ics</button><button class="secondary-button" data-action="google-calendar-sync">↻ Sync</button><button class="primary-button" data-action="add-calendar-event">＋ Event</button><button class="secondary-button" data-action="add-task">＋ Task</button></div></div><div class="panel calendar-panel"><div class="calendar-head"><h2>${new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(context.calendarDate)}</h2><div class="calendar-nav"><button data-action="prev-month">‹</button><button data-action="calendar-today">Today</button><button data-action="next-month">›</button></div></div><div class="calendar-grid">${["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((day) => `<div class="day-name">${day}</div>`).join("")}${cells}</div></div></div>`;
}

export function renderNotesView(context: WorkspaceViewContext): string {
  return `<div class="view-wrap"><div class="title-row"><div><p class="eyebrow">A place to think</p><h1>Scratch notes</h1><p class="date-line">Loose thoughts are welcome here.</p></div><button class="primary-button" data-action="add-note">＋ New note</button></div><div class="note-grid">${context.state.notes.length ? context.state.notes.map((note) => `<article class="note-card"><div class="card-actions"><button data-action="delete-note" data-id="${note.id}">×</button></div><h3>${escapeHtml(note.title)}</h3><p>${escapeHtml(note.body)}</p><div class="card-meta">${formatShort(note.date)}</div></article>`).join("") : '<div class="empty large-empty"><span class="empty-icon">✎</span>Your scratch space is clear.<br>Capture an idea whenever it arrives.</div>'}</div></div>`;
}

export function renderLinksView(context: WorkspaceViewContext): string {
  return `<div class="view-wrap"><div class="title-row"><div><h1>Quick links</h1></div><button class="primary-button" data-action="add-link">＋ Add link</button></div><div class="link-grid">${context.state.links.length ? context.state.links.map((link) => `<a class="link-card" href="${escapeHtml(link.url)}" aria-label="${escapeHtml(quickLinkAccessibleLabel(link))}" title="${escapeHtml(quickLinkHoverText(link))}"><div class="link-card-heading">${renderQuickLinkAsset(link, "link-card-asset")}<div><div class="link-type">${quickLinkType(link.url)}</div><h3>${escapeHtml(link.title)}</h3></div></div><div class="card-actions"><button data-action="edit-link" data-id="${link.id}" aria-label="Edit ${escapeHtml(link.title)}">✎</button><button data-action="delete-link" data-id="${link.id}" aria-label="Delete ${escapeHtml(link.title)}">×</button></div></a>`).join("") : '<div class="empty large-empty"><span class="empty-icon">↗</span>No quick links yet.<br>Add a folder, file, or website.</div>'}</div></div>`;
}
