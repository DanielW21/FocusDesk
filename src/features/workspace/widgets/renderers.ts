import type {
  WidgetDimension,
  WidgetRenderContext,
} from "../../../contracts/widgets";
import { WorkspaceWidgetDataSchema } from "../model";
import { dimensionParts, visualRows } from "../../../widgets/widget-dimensions";
import {
  quickLinkAccessibleLabel,
  quickLinkColor,
  quickLinkHoverText,
  renderQuickLinkAsset,
} from "../quick-links";

function escapeHtml(value = ""): string {
  const replacements: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  };
  return value.replace(
    /[&<>'"]/g,
    (character) => replacements[character] ?? character,
  );
}

function formatLong(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}

function dataFrom(context: WidgetRenderContext) {
  return WorkspaceWidgetDataSchema.parse(context.data);
}

function dimensionRows(dimension: WidgetDimension): number {
  return visualRows(dimension);
}

function dimensionColumns(dimension: WidgetDimension): number {
  return dimensionParts(dimension).columns;
}

export function renderTracker(
  context: WidgetRenderContext,
  dimension: WidgetDimension,
): string {
  const data = dataFrom(context);
  const tasks = data.tasks.filter((task) => task.date === data.selectedDate);
  const complete = tasks.filter((task) => task.done).length;
  const openTasks = tasks.filter((task) => !task.done);
  const percent = tasks.length
    ? Math.round((complete / tasks.length) * 100)
    : 0;
  const bars =
    dimensionRows(dimension) <= 1
      ? ""
      : `<div class="mini-bars">${tasks
          .slice(0, 5)
          .map((task) => `<i class="${task.done ? "filled" : ""}"></i>`)
          .join("")}</div>`;
  return `<div class="bubble-tracker"><div class="bubble-ring" style="--progress:${percent * 3.6}deg"><span>${percent}<small>%</small></span></div><div class="tracker-copy"><strong>${complete} of ${tasks.length}</strong><span>${percent === 100 ? "Day complete" : `${openTasks.length} left for today`}</span>${bars}</div></div>`;
}

export function renderClock(): string {
  return `<div class="bubble-clock"><strong data-live-clock>--:--</strong><span data-live-date>${formatLong(new Date())}</span></div>`;
}

export function renderTasks(
  context: WidgetRenderContext,
  dimension: WidgetDimension,
): string {
  const data = dataFrom(context);
  const openTasks = data.tasks.filter(
    (task) => task.date === data.selectedDate && !task.done,
  );
  const content = openTasks.length
    ? openTasks
        .slice(
          0,
          dimensionRows(dimension) <= 1
            ? 1
            : dimensionRows(dimension) >= 3 || dimensionColumns(dimension) >= 4
              ? 6
              : 3,
        )
        .map(
          (task) =>
            `<div><i class="${task.priority ?? "normal"}"></i><span>${escapeHtml(task.title)}</span><small>${task.time ?? ""}</small></div>`,
        )
        .join("")
    : "<p>Nothing left today <b>✓</b></p>";
  return `<div class="bubble-task-list">${content}</div><div class="widget-foot">${openTasks.length} open <span>＋ quick add</span></div>`;
}

export function renderSchedule(
  context: WidgetRenderContext,
  dimension: WidgetDimension,
): string {
  const data = dataFrom(context);
  const events = data.events.filter(
    (event) => event.date === data.selectedDate,
  );
  const rows = dimensionRows(dimension);
  const columns = dimensionColumns(dimension);
  const useTwoColumns = rows >= 2 && columns >= 2;
  const scheduleRows = useTwoColumns
    ? Math.max(1, Math.ceil(events.length / 2))
    : Math.max(1, events.length);
  const content = events.length
    ? events
        .map(
          (event) =>
            `<div><time>${escapeHtml(event.time ?? "ALL DAY")}</time><span>${escapeHtml(event.title)}</span></div>`,
        )
        .join("")
    : '<div class="free-day"><strong>Wide open</strong><span>No calendar events</span></div>';
  const scheduleClass = useTwoColumns ? " schedule-columns" : "";
  return `<div class="bubble-schedule${scheduleClass}" style="--schedule-rows:${scheduleRows}">${content}</div>`;
}

export function renderFocus(context: WidgetRenderContext): string {
  const data = dataFrom(context);
  const nextTask = data.tasks.find(
    (task) => task.date === data.selectedDate && !task.done,
  );
  const duration = data.focusDurationMinutes ?? 25;
  return `<div class="bubble-focus"><div class="focus-play">▶</div><div><strong>${duration}:00</strong><span>${nextTask ? escapeHtml(nextTask.title) : "Choose a task"}</span></div></div>`;
}

export function renderNotes(
  context: WidgetRenderContext,
  dimension: WidgetDimension,
): string {
  const data = dataFrom(context);
  const latestNote = data.notes[data.notes.length - 1];
  if (!latestNote)
    return '<div class="bubble-note"><strong>Blank page</strong><p>Tap to capture a thought.</p></div>';
  const body = latestNote.body.slice(
    0,
    dimensionRows(dimension) >= 2 || dimensionColumns(dimension) >= 4
      ? 180
      : 72,
  );
  return `<div class="bubble-note"><strong>${escapeHtml(latestNote.title)}</strong><p>${escapeHtml(body)}</p></div>`;
}

export function renderLinks(
  context: WidgetRenderContext,
  dimension: WidgetDimension,
): string {
  const data = dataFrom(context);
  const content = data.links.length
    ? data.links
        .slice(
          0,
          dimensionRows(dimension) >= 2 || dimensionColumns(dimension) >= 4
            ? 8
            : 4,
        )
        .map(
          (link) =>
            `<a class="quick-link-icon" href="${escapeHtml(link.url)}" style="--quick-link-color:${quickLinkColor(link)}" data-action="open-quick-link" data-link-id="${link.id}" data-tooltip="${escapeHtml(quickLinkHoverText(link))}" title="${escapeHtml(quickLinkHoverText(link))}" aria-label="${escapeHtml(quickLinkAccessibleLabel(link))}">${renderQuickLinkAsset(link, "quick-link-icon-asset")}</a>`,
        )
        .join("")
    : '<div class="empty-links">＋<small>Add shortcuts</small></div>';
  return `<div class="bubble-links">${content}</div>`;
}
