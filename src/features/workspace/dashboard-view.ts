import type { AppState } from "../../app/app-state";
import type { AppRegistries } from "../../app/bootstrap";
import type {
  WidgetDimension,
  WidgetInstance,
  WidgetSettings,
} from "../../contracts/widgets";
import { dimensionParts, visualRows } from "../../widgets/widget-dimensions";
import { parseDate, localDate } from "../../ui/formatters";

export interface DashboardViewContext {
  state: AppState;
  now: Date;
  selectedDate: string;
  widgetEditMode: boolean;
  phonePreview: boolean;
  registries: AppRegistries;
  widgetData: () => unknown;
}

export function widgetStyleKey(widgetId: string): string {
  const segments = widgetId.split(".");
  return segments[segments.length - 1] ?? widgetId;
}

export function dimensionLabel(dimension: WidgetDimension): string {
  return dimension.replace("x", "×");
}

export function largestDimension(
  dimensions: readonly WidgetDimension[],
): WidgetDimension {
  return (
    [...dimensions].sort((left, right) => {
      const leftParts = dimensionParts(left);
      const rightParts = dimensionParts(right);
      return (
        rightParts.columns * rightParts.rows -
        leftParts.columns * leftParts.rows
      );
    })[0] ?? "1x2"
  );
}

export function renderWidgetBody(
  widget: WidgetInstance,
  context: DashboardViewContext,
  requestedDimension = widget.dimension,
  settings: WidgetSettings = widget.settings,
): string {
  const definition = context.registries.widgets.require(widget.widgetId);
  const view =
    definition.views[requestedDimension] ??
    definition.views[definition.manifest.defaultDimension];
  if (!view)
    throw new Error(`Widget ${widget.widgetId} has no renderable view`);
  return view.render({ data: context.widgetData(), settings });
}

function weekStrip(context: DashboardViewContext): string {
  const anchor = parseDate(context.selectedDate);
  const sunday = new Date(anchor);
  sunday.setDate(anchor.getDate() - anchor.getDay());
  const dates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(sunday);
    date.setDate(sunday.getDate() + index);
    return date;
  });
  return `<div class="week-strip">${dates
    .map((date) => {
      const key = localDate(date);
      const taskCount = context.state.tasks.filter(
        (task) => task.date === key && !task.done,
      ).length;
      return `<button class="week-day ${key === context.selectedDate ? "selected" : ""} ${key === localDate(context.now) ? "is-today" : ""}" data-action="select-date" data-date="${key}">
        <span>${new Intl.DateTimeFormat("en", { weekday: "short" }).format(date)}</span>
        <strong>${date.getDate()}</strong>
        <i class="day-marker ${taskCount ? "has-items" : ""}">${taskCount || ""}</i>
      </button>`;
    })
    .join("")}</div>`;
}

function widgetCard(
  widget: WidgetInstance,
  context: DashboardViewContext,
): string {
  const definition = context.registries.widgets.require(widget.widgetId);
  const meta = definition.manifest;
  const styleKey = widgetStyleKey(widget.widgetId);
  const headerTitle = styleKey === "task-manager" ? "Weekly View" : meta.title;
  const { columns } = dimensionParts(widget.dimension);
  const rows = visualRows(widget.dimension);
  const dimensionOptions = meta.supportedDimensions
    .map(
      (dimension) =>
        `<option value="${dimension}" ${dimension === widget.dimension ? "selected" : ""}>${dimensionLabel(dimension)}</option>`,
    )
    .join("");
  const surface =
    styleKey === "links" || widget.widgetId === "waterlooworks.jobs"
      ? `<div class="widget-surface" data-action="open-widget" data-widget-id="${widget.id}" role="button" tabindex="0" aria-label="Open ${meta.title}">`
      : `<button class="widget-surface" data-action="open-widget" data-widget-id="${widget.id}" aria-label="Open ${meta.title}">`;
  const surfaceEnd =
    styleKey === "links" || widget.widgetId === "waterlooworks.jobs"
      ? "</div>"
      : "</button>";
  return `<article class="desk-widget widget-${styleKey} dimension-${widget.dimension} ${context.widgetEditMode ? "editing" : ""}" data-widget-id="${widget.id}" data-widget-columns="${columns}" data-widget-rows="${rows}" style="--widget-columns:${columns};--widget-rows:${rows};" draggable="${context.widgetEditMode}">
    ${context.widgetEditMode ? `<div class="widget-edit-controls"><label class="sr-only" for="widget-dimension-${widget.id}">Choose widget dimensions</label><select id="widget-dimension-${widget.id}" class="widget-dimension-select" data-action="set-widget-dimension" data-widget-id="${widget.id}" title="Choose dimensions">${dimensionOptions}</select><button data-action="hide-widget" data-widget-id="${widget.id}" title="Hide widget">−</button></div><div class="drag-handle">••••••</div>` : ""}
    ${surface}
      <header class="widget-header"><span class="widget-symbol">${meta.icon}</span><span>${headerTitle}</span><i>↗</i></header>
      ${renderWidgetBody(widget, context)}
    ${surfaceEnd}
  </article>`;
}

export function renderTodayView(context: DashboardViewContext): string {
  return `<div class="view-wrap widget-dashboard-view">
    ${weekStrip(context)}
    ${context.widgetEditMode ? '<div class="edit-banner"><span class="wiggle-dot"></span><strong>Customize your space</strong><span>Drag to reorder · choose dimensions · hide what you do not need</span></div>' : ""}
    <div class="widget-stage ${context.phonePreview ? "phone-preview" : ""}">
      ${context.phonePreview ? '<div class="phone-status"><span>9:41</span><b>FocusDesk</b><span>● ◒</span></div>' : ""}
      <div class="widget-canvas">
        ${context.state.widgetLayout.instances
          .filter((widget) => widget.visible)
          .map((widget) => widgetCard(widget, context))
          .join("")}
        ${context.widgetEditMode ? '<button class="empty-widget-slot" data-action="add-widget"><span>＋</span>Add a widget</button>' : ""}
      </div>
      ${context.phonePreview ? '<div class="phone-home-bar"></div>' : ""}
    </div>
  </div>`;
}
