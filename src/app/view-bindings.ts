import { bindViewActions as bindFeatureActions } from "./view-actions";
import type { ViewActionContext } from "./view-actions";
import type { AppState, TaskFilter } from "./app-state";
import type {
  AppView,
  TaskManagerMode,
  TaskManagerProgressView,
} from "./view-types";
import {
  FocusDeskAccentSchema,
  FocusDeskDensitySchema,
  FocusDeskProgressViewSchema,
  FocusDeskTaskManagerModeSchema,
  FocusDeskThemeSchema,
  type FocusDeskSettings,
} from "../settings";

export interface ViewBindingsContext {
  featureActions: ViewActionContext;
  state: AppState;
  render: () => void;
  setView: (view: AppView) => void;
  setTaskFilter: (filter: TaskFilter) => void;
  setTaskManagerMode: (mode: TaskManagerMode) => void;
  setTaskManagerProgressView: (view: TaskManagerProgressView) => void;
  updateSetting: (key: keyof FocusDeskSettings, value: unknown) => void;
  taskManagerCommand: (command: string) => void;
  refreshSettingsStatus: () => void;
  getSelectedDate: () => string;
  createQuickTask: (title: string, date: string) => void;
  setWidgetDimension: (widgetId: string, rawDimension: string) => void;
  persist: () => void;
}

let draggedWidgetId: string | undefined;

export function bindViewBindings(context: ViewBindingsContext): void {
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(
    (button) =>
      (button.onclick = () => {
        const nextView = button.dataset.view as AppView | undefined;
        if (!nextView) return;
        context.setView(nextView);
        context.render();
        if (nextView === "settings") context.refreshSettingsStatus();
      }),
  );
  document.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach(
    (button) =>
      (button.onclick = () => {
        const filter = button.dataset.filter as TaskFilter | undefined;
        if (!filter) return;
        context.setTaskFilter(filter);
        context.render();
      }),
  );
  document
    .querySelectorAll<HTMLButtonElement>("[data-taskmanager-mode]")
    .forEach(
      (button) =>
        (button.onclick = () => {
          const mode = button.dataset.taskmanagerMode as
            TaskManagerMode | undefined;
          if (!mode) return;
          context.setTaskManagerMode(mode);
          context.render();
        }),
    );
  document
    .querySelectorAll<HTMLButtonElement>("[data-taskmanager-progress-view]")
    .forEach(
      (button) =>
        (button.onclick = () => {
          const progressView = button.dataset.taskmanagerProgressView as
            TaskManagerProgressView | undefined;
          if (!progressView) return;
          context.setTaskManagerProgressView(progressView);
          context.render();
        }),
    );
  document.querySelectorAll<HTMLSelectElement>("select[data-setting]").forEach(
    (select) =>
      (select.onchange = () => {
        const key = select.dataset.setting as
          keyof FocusDeskSettings | undefined;
        if (!key) return;
        let value: unknown = select.value;
        if (key === "theme") {
          const parsed = FocusDeskThemeSchema.safeParse(select.value);
          if (!parsed.success) return;
          value = parsed.data;
        }
        if (key === "density") {
          const parsed = FocusDeskDensitySchema.safeParse(select.value);
          if (!parsed.success) return;
          value = parsed.data;
        }
        if (key === "accent") {
          const parsed = FocusDeskAccentSchema.safeParse(select.value);
          if (!parsed.success) return;
          value = parsed.data;
        }
        if (key === "taskManagerMode") {
          const parsed = FocusDeskTaskManagerModeSchema.safeParse(select.value);
          if (!parsed.success) return;
          value = parsed.data;
        }
        if (key === "taskManagerProgressView") {
          const parsed = FocusDeskProgressViewSchema.safeParse(select.value);
          if (!parsed.success) return;
          value = parsed.data;
        }
        if (key === "taskManagerTodoDays") value = Number(select.value);
        if (key === "focusDurationMinutes") value = Number(select.value);
        context.updateSetting(key, value);
      }),
  );
  document
    .querySelectorAll<HTMLSelectElement>(
      'select[data-action="settings-widget-dimension"], select[data-action="set-widget-dimension"]',
    )
    .forEach(
      (select) =>
        (select.onchange = () => {
          if (select.dataset.widgetId)
            context.setWidgetDimension(select.dataset.widgetId, select.value);
        }),
    );
  document.querySelectorAll<HTMLImageElement>("[data-link-asset]").forEach(
    (image) =>
      (image.onerror = () => {
        image.hidden = true;
      }),
  );
  document
    .querySelectorAll<HTMLElement>('[data-action="open-widget"][role="button"]')
    .forEach(
      (surface) =>
        (surface.onkeydown = (event) => {
          if (event.target !== surface) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            surface.click();
          }
        }),
    );
  const taskManagerCommandInput = document.querySelector<HTMLInputElement>(
    "#taskmanager-command",
  );
  if (taskManagerCommandInput) {
    taskManagerCommandInput.onkeydown = (event) => {
      if (event.key === "Enter")
        context.taskManagerCommand(taskManagerCommandInput.value);
    };
  }

  bindFeatureActions(context.featureActions);

  const quickTask = document.querySelector<HTMLInputElement>("#quick-task");
  if (quickTask)
    quickTask.onkeydown = (event) => {
      if (event.key !== "Enter" || !quickTask.value.trim()) return;
      context.createQuickTask(
        quickTask.value.trim(),
        context.getSelectedDate(),
      );
    };

  document
    .querySelectorAll<HTMLElement>(
      '[data-action="quick-add-task"][role="button"], [data-action="add-task"][role="button"]',
    )
    .forEach(
      (control) =>
        (control.onkeydown = (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          control.click();
        }),
    );

  document
    .querySelectorAll<HTMLElement>('.desk-widget[draggable="true"]')
    .forEach((widget) => {
      widget.ondragstart = () => {
        draggedWidgetId = widget.dataset.widgetId;
        widget.classList.add("dragging");
      };
      widget.ondragover = (event) => {
        event.preventDefault();
        widget.classList.add("drag-over");
      };
      widget.ondragleave = () => widget.classList.remove("drag-over");
      widget.ondrop = (event) => {
        event.preventDefault();
        const targetId = widget.dataset.widgetId;
        if (!draggedWidgetId || !targetId || draggedWidgetId === targetId)
          return;
        const from = context.state.widgetLayout.instances.findIndex(
          (item) => item.id === draggedWidgetId,
        );
        const to = context.state.widgetLayout.instances.findIndex(
          (item) => item.id === targetId,
        );
        if (from < 0 || to < 0) return;
        const [moved] = context.state.widgetLayout.instances.splice(from, 1);
        if (!moved) return;
        context.state.widgetLayout.instances.splice(to, 0, moved);
        const timestamp = new Date().toISOString();
        context.state.widgetLayout.instances.forEach((item, order) => {
          item.order = order;
          item.updatedAt = timestamp;
        });
        draggedWidgetId = undefined;
        context.persist();
      };
      widget.ondragend = () => {
        draggedWidgetId = undefined;
        widget.classList.remove("dragging");
        document
          .querySelectorAll(".drag-over")
          .forEach((item) => item.classList.remove("drag-over"));
      };
    });
}
