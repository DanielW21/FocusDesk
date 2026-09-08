import type { AppState } from "../../app/app-state";
import type { AppRegistries } from "../../app/bootstrap";
import type { AppView } from "../../app/view-types";
import { WidgetDimensionSchema } from "../../contracts/widgets";
import type { EditorType } from "./editor";
import {
  renderWidgetBody,
  widgetStyleKey,
  largestDimension,
  type DashboardViewContext,
} from "./dashboard-view";
import {
  renderEventsFor,
  renderTaskList,
  type WorkspaceViewContext,
} from "./workspace-views";
import { taskIsDueOnDate } from "./model";

export interface DashboardActionsContext {
  state: AppState;
  registries: AppRegistries;
  getSelectedDate: () => string;
  dashboardViewContext: () => DashboardViewContext;
  workspaceViewContext: () => WorkspaceViewContext;
  showModal: (content: string) => void;
  closeModal: () => void;
  bindViewActions: () => void;
  updateClocks: () => void;
  setView: (view: AppView) => void;
  render: () => void;
  openFocus: (taskId: number) => void;
  openEditor: (type: EditorType) => void;
  save: () => void;
  persist: (layoutChanged?: boolean) => void;
  restoreDefaultLayout: () => void;
}

export interface DashboardActions {
  openWidget: (widgetId: string) => void;
  refreshOpenWidget: () => void;
  openWidgetPicker: () => void;
  setWidgetDimension: (widgetId: string, rawDimension: string) => void;
  toggleWidgetFromSettings: (widgetId: string) => void;
  restoreDefaultDashboard: () => void;
}

export function createDashboardActions(
  context: DashboardActionsContext,
): DashboardActions {
  const {
    state,
    registries,
    getSelectedDate,
    dashboardViewContext,
    workspaceViewContext,
    showModal,
    closeModal,
    bindViewActions,
    updateClocks,
    setView,
    render,
    openFocus,
    openEditor,
    save,
    persist,
    restoreDefaultLayout,
  } = context;

  function openWidget(widgetId: string): void {
    const widget = state.widgetLayout.instances.find(
      (item) => item.id === widgetId,
    );
    if (!widget) return;
    if (widget.widgetId === "waterlooworks.jobs") {
      setView("waterlooworks");
      render();
      return;
    }
    const meta = registries.widgets.require(widget.widgetId).manifest;
    const styleKey = widgetStyleKey(widget.widgetId);
    const selectedDate = getSelectedDate();
    const tasks = state.tasks.filter((task) =>
      taskIsDueOnDate(task, selectedDate),
    );
    const actionLabels: Partial<Record<string, string>> = {
      tasks: "Open all tasks",
      schedule: "Open calendar",
      notes: "Open notes",
      links: "Open links",
    };
    const detailBody =
      styleKey === "schedule"
        ? `<div class="detail-events schedule-detail-events">${renderEventsFor(selectedDate, workspaceViewContext()) || '<div class="empty">No events on this day.</div>'}</div>`
        : styleKey === "tasks"
          ? `<div class="detail-task-list">${renderTaskList(tasks, selectedDate)}</div>`
          : `<div class="widget-detail-body widget-${styleKey}">${renderWidgetBody(widget, dashboardViewContext(), largestDimension(meta.supportedDimensions), { ...widget.settings, taskManagerExpanded: styleKey === "task-manager" })}</div>`;

    showModal(`<div class="widget-detail">
    <div class="widget-detail-head"><div class="widget-detail-icon widget-${styleKey}">${meta.icon}</div><div><div class="modal-kicker">${meta.description}</div><h2>${meta.title}</h2></div></div>
    ${detailBody}
    ${styleKey === "tracker" ? `<div class="detail-task-list">${renderTaskList(tasks, selectedDate)}</div>` : ""}
    ${styleKey === "focus" ? `<button class="primary-button detail-primary" id="detail-focus">Start a ${state.settings.focusDurationMinutes} minute session</button>` : ""}
    ${actionLabels[styleKey] ? `<button class="secondary-button detail-primary" id="detail-navigate">${actionLabels[styleKey]}</button>` : ""}
  </div>`);
    document
      .querySelector<HTMLElement>(".modal")
      ?.classList.add("widget-full-modal");
    const modal = document.querySelector<HTMLElement>(".modal");
    if (modal) modal.dataset.widgetId = widgetId;
    bindViewActions();
    updateClocks();

    const focusButton =
      document.querySelector<HTMLButtonElement>("#detail-focus");
    if (focusButton)
      focusButton.onclick = () => {
        closeModal();
        const task = tasks.find((item) => !item.done);
        if (task) openFocus(task.id);
        else openEditor("task");
      };
    const navigateButton =
      document.querySelector<HTMLButtonElement>("#detail-navigate");
    if (navigateButton)
      navigateButton.onclick = () => {
        const target: Partial<Record<string, AppView>> = {
          tasks: "tasks",
          schedule: "calendar",
          notes: "notes",
          links: "links",
        };
        const targetView = target[styleKey];
        if (targetView) {
          setView(targetView);
          closeModal();
          render();
        }
      };
  }

  function refreshOpenWidget(): void {
    const modal = document.querySelector<HTMLElement>(
      ".modal.widget-full-modal[data-widget-id]",
    );
    const widgetId = modal?.dataset.widgetId;
    if (widgetId) openWidget(widgetId);
  }

  function openWidgetPicker(): void {
    showModal(
      `<div class="widget-picker"><div class="modal-kicker">WIDGET GALLERY</div><h2>Build your space</h2><p>Choose what earns a place on your dashboard.</p><div class="widget-picker-grid">${registries.widgets
        .list()
        .map((definition) => {
          const current = state.widgetLayout.instances.find(
            (item) => item.widgetId === definition.manifest.id,
          );
          const meta = definition.manifest;
          const styleKey = widgetStyleKey(meta.id);
          return `<button data-pick-widget="${meta.id}" class="${current?.visible ? "active" : ""}"><span class="picker-icon widget-${styleKey}">${meta.icon}</span><strong>${meta.title}</strong><small>${meta.description}</small><i>${current?.visible ? "Added ✓" : "Add +"}</i></button>`;
        })
        .join("")}</div></div>`,
    );
    document
      .querySelector<HTMLElement>(".modal")
      ?.classList.add("picker-modal");
    document.querySelectorAll<HTMLButtonElement>("[data-pick-widget]").forEach(
      (button) =>
        (button.onclick = () => {
          const widgetId = button.dataset.pickWidget;
          if (!widgetId) return;
          const current = state.widgetLayout.instances.find(
            (item) => item.widgetId === widgetId,
          );
          if (current) current.visible = !current.visible;
          else {
            const definition = registries.widgets.require(widgetId);
            const timestamp = new Date().toISOString();
            state.widgetLayout.instances.push({
              id: `${widgetStyleKey(widgetId)}-${Date.now()}`,
              widgetId,
              dimension: definition.manifest.defaultDimension,
              visible: true,
              order: state.widgetLayout.instances.length,
              settings: { ...definition.defaultSettings },
              createdAt: timestamp,
              updatedAt: timestamp,
            });
          }
          state.widgetLayout.revision += 1;
          save();
          openWidgetPicker();
        }),
    );
  }

  function setWidgetDimension(widgetId: string, rawDimension: string): void {
    const widget = state.widgetLayout.instances.find(
      (item) => item.id === widgetId,
    );
    if (!widget) return;
    const parsed = WidgetDimensionSchema.safeParse(rawDimension);
    if (!parsed.success) return;
    const definition = registries.widgets.require(widget.widgetId);
    if (!definition.views[parsed.data]) return;
    widget.dimension = parsed.data;
    widget.updatedAt = new Date().toISOString();
    persist(true);
  }

  function toggleWidgetFromSettings(widgetId: string): void {
    const widget = state.widgetLayout.instances.find(
      (item) => item.widgetId === widgetId,
    );
    if (widget) {
      widget.visible = !widget.visible;
      widget.updatedAt = new Date().toISOString();
    } else {
      const definition = registries.widgets.require(widgetId);
      const timestamp = new Date().toISOString();
      state.widgetLayout.instances.push({
        id: `${widgetStyleKey(widgetId)}-${Date.now()}`,
        widgetId,
        dimension: definition.manifest.defaultDimension,
        visible: true,
        order: state.widgetLayout.instances.length,
        settings: { ...definition.defaultSettings },
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    persist(true);
  }

  function restoreDefaultDashboard(): void {
    if (!window.confirm("Restore the default dashboard layout?")) return;
    restoreDefaultLayout();
    persist(true);
  }

  return {
    openWidget,
    refreshOpenWidget,
    openWidgetPicker,
    setWidgetDimension,
    toggleWidgetFromSettings,
    restoreDefaultDashboard,
  };
}
