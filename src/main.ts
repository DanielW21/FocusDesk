import { createAppRegistries } from "./app/bootstrap";
import { bindViewBindings } from "./app/view-bindings";
import type { ViewActionContext } from "./app/view-actions";
import type {
  AppView,
  TaskManagerMode,
  TaskManagerProgressView,
} from "./app/view-types";
import type { AppState, TaskFilter } from "./app/app-state";
import {
  FocusDeskDatabase,
  FocusDeskDatabaseDocumentSchema,
  type FocusDeskDatabaseDocument,
} from "./app/app-database";
import { createDefaultWidgetLayout } from "./features/workspace/default-layout";
import { createFocusDeskTasksClient } from "./features/workspace/tasks-client";
import { createNativeWorkspaceClient } from "./features/workspace/native-workspace-client";
import { createWorkspaceController } from "./features/workspace/controller";
import { createDashboardActions } from "./features/workspace/dashboard-actions";
import { createWorkspaceModalActions } from "./features/workspace/modal-actions";
import {
  taskIsOpenOnDate,
  type CalendarEvent,
  type Task,
} from "./features/workspace/model";
import {
  isNativeBridgeAvailable,
  openNativeLink,
} from "./platform/native-bridge";
import {
  refreshTaskManagerRuntime,
  taskManagerRuntime,
} from "./features/tasks/runtime";
import { renderTaskManagerView } from "./features/tasks/task-manager-view";
import { createTaskManagerActions } from "./features/tasks/task-manager-actions";
import type { TaskManagerStatus } from "./features/tasks/model";
import {
  openEditor as openWorkspaceEditor,
  openQuickTask as openWorkspaceQuickTask,
} from "./features/workspace/editor";
import { WidgetLayoutStore } from "./widgets/widget-layout-store";
import {
  DEFAULT_FOCUSDESK_SETTINGS,
  FocusDeskSettingsSchema,
  parseFocusDeskSettings,
  type FocusDeskSettings,
} from "./settings";
import { createGoogleCalendarClient } from "./features/workspace/google-calendar-client";
import { withWaterlooWorksWidget } from "./app/feature-layout-upgrades";
import {
  renderTodayView,
  type DashboardViewContext,
} from "./features/workspace/dashboard-view";
import {
  renderCalendarView,
  renderLinksView,
  renderNotesView,
  renderTasksView,
  type WorkspaceViewContext,
} from "./features/workspace/workspace-views";
import {
  renderSettingsView,
  type SettingsViewContext,
} from "./features/workspace/settings-view";
import { createWaterlooWorksController } from "./features/waterlooworks/controller";
import { createWaterlooWorksEvaluatorConfigClient } from "./features/waterlooworks/evaluator-config-client";
import { createWaterlooWorksSettingsActions } from "./features/waterlooworks/settings-actions";
import { element } from "./ui/dom";
import { escapeHtml, localDate } from "./ui/formatters";
import "./features/waterlooworks/waterlooworks.css";

type View = AppView;
const registries = createAppRegistries();
const widgetLayoutStore = new WidgetLayoutStore(registries.widgets);
const nativeWorkspaceClient = createNativeWorkspaceClient();
let nativeWorkspaceReady = false;
let nativeWorkspaceSaveQueue = Promise.resolve();
let nativeWorkspaceMessage = "";

function queueNativeWorkspaceSave(document: FocusDeskDatabaseDocument): void {
  if (!nativeWorkspaceReady || !isNativeBridgeAvailable()) return;
  nativeWorkspaceSaveQueue = nativeWorkspaceSaveQueue
    .then(() => nativeWorkspaceClient.save(document))
    .then(() => {
      nativeWorkspaceMessage = "";
    })
    .catch((error: unknown) => {
      nativeWorkspaceMessage = `Database save failed; changes remain in the local mirror. ${error instanceof Error ? error.message : "Try again after restarting FocusDesk."}`;
      render();
    });
}

const appDatabase = new FocusDeskDatabase(
  localStorage,
  undefined,
  undefined,
  queueNativeWorkspaceSave,
);
const focusDeskTasksClient = createFocusDeskTasksClient();
const googleCalendarClient = createGoogleCalendarClient();
const now = new Date();
let view: View = "today";
let selectedDate = localDate(now);
let calendarDate = new Date(now.getFullYear(), now.getMonth(), 1);
let taskFilter: TaskFilter = "all";
let taskManagerStatusMenuId: string | undefined;
let taskManagerCommandMessage = "";
let widgetEditMode = false;
let phonePreview = false;
let clockInterval: number | undefined;

const starterState: AppState = {
  tasks: [
    {
      id: 1,
      title: "Set up my FocusDesk",
      done: false,
      tag: "Setup",
      date: localDate(now),
      time: "09:00",
      priority: "high",
      recurrence: null,
      completedDates: [],
    },
    {
      id: 2,
      title: "Plan the three most important things",
      done: true,
      tag: "Planning",
      date: localDate(now),
      time: "10:00",
      priority: "normal",
      recurrence: null,
      completedDates: [],
    },
  ],
  events: [],
  notes: [],
  links: [],
  widgetLayout: createDefaultWidgetLayout(),
  settings: { ...DEFAULT_FOCUSDESK_SETTINGS },
};

const state = loadState();
const workspaceController = createWorkspaceController({
  state,
  focusDeskTasksClient,
  googleCalendarClient,
  save: () => appDatabase.save(state),
  render: () => render(),
});
const workspaceModalActions = createWorkspaceModalActions({
  state,
  showModal: (content) => showModal(content),
});
const dashboardActions = createDashboardActions({
  state,
  registries,
  getSelectedDate: () => selectedDate,
  dashboardViewContext,
  workspaceViewContext,
  showModal: (content) => showModal(content),
  closeModal: () => closeModal(),
  bindViewActions: () => bindViewActions(),
  updateClocks,
  setView: (nextView) => {
    view = nextView;
  },
  render: () => render(),
  openFocus: (taskId) => openFocus(taskId),
  openEditor: (type) => openEditor(type),
  save: () => appDatabase.save(state),
  persist: (layoutChanged = false) => persist(layoutChanged),
  restoreDefaultLayout: () => {
    state.widgetLayout = withWaterlooWorksWidget(createDefaultWidgetLayout());
  },
});
appDatabase.ensure(state);
const waterlooWorksController = createWaterlooWorksController({
  getConfig: () => state.settings.waterlooWorks,
  onConfigChange: (config) => {
    state.settings.waterlooWorks = config;
    appDatabase.save(state);
  },
});
const waterlooWorksEvaluatorConfigClient =
  createWaterlooWorksEvaluatorConfigClient();
const waterlooWorksSettingsActions = createWaterlooWorksSettingsActions({
  client: waterlooWorksEvaluatorConfigClient,
  render: () => render(),
  isNativeBridgeAvailable,
  isSettingsView: () => view === "settings",
});
let taskManagerMode: TaskManagerMode = state.settings.taskManagerMode;
let taskManagerProgressView: TaskManagerProgressView =
  state.settings.taskManagerProgressView;
let taskManagerTodoDays = state.settings.taskManagerTodoDays;
applySettings();

const taskManagerActions = createTaskManagerActions({
  runtime: taskManagerRuntime,
  registries,
  render: () => render(),
  showModal: (content) => showModal(content),
  closeModal: () => closeModal(),
  focusElement: (selector) => element(selector),
  refreshRuntime: () => refreshTaskManagerRuntime(),
  getMode: () => taskManagerMode,
  setMode: (mode) => {
    taskManagerMode = mode;
  },
  getTodoDays: () => taskManagerTodoDays,
  setTodoDays: (days) => {
    taskManagerTodoDays = days;
  },
  setCommandMessage: (message) => {
    taskManagerCommandMessage = message;
  },
});

function loadState(): AppState {
  const saved = appDatabase.load(starterState);
  return {
    tasks: saved.tasks,
    events: saved.events,
    notes: saved.notes,
    links: saved.links,
    widgetLayout: withWaterlooWorksWidget(
      widgetLayoutStore.load(saved.widgetLayout, createDefaultWidgetLayout()),
    ),
    settings: parseFocusDeskSettings(saved.settings),
  };
}

async function initializeNativeWorkspace(): Promise<void> {
  if (!isNativeBridgeAvailable()) return;

  try {
    const document = await nativeWorkspaceClient.load();
    const parsed = FocusDeskDatabaseDocumentSchema.safeParse(document);
    if (document !== undefined && !parsed.success) {
      throw new Error(
        "The saved workspace is incompatible or unreadable; it has not been overwritten.",
      );
    }
    if (parsed.success) {
      state.events = [...parsed.data.tables.events];
      state.notes = [...parsed.data.tables.notes];
      state.links = [...parsed.data.tables.links];
      state.widgetLayout = withWaterlooWorksWidget(
        widgetLayoutStore.load(
          parsed.data.dashboard.widgetLayout,
          createDefaultWidgetLayout(),
        ),
      );
      state.settings = parseFocusDeskSettings(parsed.data.dashboard.settings);
      taskManagerMode = state.settings.taskManagerMode;
      taskManagerProgressView = state.settings.taskManagerProgressView;
      taskManagerTodoDays = state.settings.taskManagerTodoDays;
      applySettings();
    }

    workspaceController.purgeUnselectedGoogleEvents();
    nativeWorkspaceReady = true;
    appDatabase.save(state);
  } catch (error: unknown) {
    nativeWorkspaceMessage = `Using the local workspace mirror. ${error instanceof Error ? error.message : "The database could not be loaded."}`;
  }
}

function persist(layoutChanged = false): void {
  if (layoutChanged) state.widgetLayout.revision += 1;
  appDatabase.save(state);
  render();
}

function applySettings(): void {
  document.documentElement.dataset.theme = state.settings.theme;
  document.documentElement.dataset.density = state.settings.density;
  document.documentElement.dataset.accent = state.settings.accent;
}

function updateSetting(key: keyof FocusDeskSettings, value: unknown): void {
  const nextSettings = {
    ...state.settings,
    [key]: value,
    ...(key === "taskManagerMode" ? { taskManagerModeConfigured: true } : {}),
  };
  const parsed = FocusDeskSettingsSchema.safeParse({
    ...nextSettings,
  });
  if (!parsed.success) return;
  state.settings = parsed.data;
  if (key === "taskManagerMode") taskManagerMode = parsed.data.taskManagerMode;
  if (key === "taskManagerProgressView")
    taskManagerProgressView = parsed.data.taskManagerProgressView;
  if (key === "taskManagerTodoDays")
    taskManagerTodoDays = parsed.data.taskManagerTodoDays;
  applySettings();
  persist();
}

function resetSettings(): void {
  state.settings = { ...DEFAULT_FOCUSDESK_SETTINGS };
  workspaceController.googleCalendar.resetSelection();
  taskManagerMode = state.settings.taskManagerMode;
  taskManagerProgressView = state.settings.taskManagerProgressView;
  taskManagerTodoDays = state.settings.taskManagerTodoDays;
  applySettings();
  persist();
}

function render(): void {
  if (clockInterval) window.clearInterval(clockInterval);
  const root = element<HTMLDivElement>("#view-root");
  const labels: Record<View, string> = {
    today: "Today",
    tasks: "All tasks",
    taskmanager: "TaskManager",
    waterlooworks: "WaterlooWorks",
    calendar: "Calendar",
    notes: "Scratch notes",
    links: "Quick links",
    settings: "Settings",
  };
  element<HTMLElement>("#page-label").textContent = labels[view];
  document
    .querySelectorAll<HTMLButtonElement>(".nav-item")
    .forEach((button) =>
      button.classList.toggle("active", button.dataset.view === view),
    );
  element<HTMLElement>("#today-count").textContent = String(
    state.tasks.filter((task) => taskIsOpenOnDate(task, localDate(now))).length,
  );

  const views: Record<View, () => string> = {
    today: () => renderTodayView(dashboardViewContext()),
    tasks: () => renderTasksView(workspaceViewContext()),
    taskmanager: taskManagerView,
    waterlooworks: waterlooWorksView,
    calendar: () => renderCalendarView(workspaceViewContext()),
    notes: () => renderNotesView(workspaceViewContext()),
    links: () => renderLinksView(workspaceViewContext()),
    settings: () => renderSettingsView(settingsViewContext()),
  };
  root.innerHTML = `${nativeWorkspaceMessage ? `<p role="alert" class="empty">${escapeHtml(nativeWorkspaceMessage)}</p>` : ""}${views[view]()}`;
  bindViewActions();
  document
    .querySelectorAll<HTMLElement>('[data-widget-id="waterlooworks-jobs"]')
    .forEach((widget) =>
      waterlooWorksController.bindWidget(
        widget,
        () => {
          view = "waterlooworks";
          render();
        },
        render,
      ),
    );
  if (view === "waterlooworks") waterlooWorksController.bind(root, render);
  updateHeaderActions();
  updateClocks();
  clockInterval = window.setInterval(updateClocks, 1000);
}

function updateHeaderActions(): void {
  const preview = document.querySelector<HTMLElement>("[data-header-preview]");
  const customize = document.querySelector<HTMLElement>(
    "[data-header-customize]",
  );
  const addWidget = document.querySelector<HTMLElement>("[data-header-add]");
  [preview, customize, addWidget].forEach((control) =>
    control?.classList.toggle("hidden", view !== "today"),
  );
  preview?.classList.toggle("active", phonePreview);
  customize?.classList.toggle("active", widgetEditMode);
  const previewLabel = document.querySelector<HTMLElement>(
    "#header-preview-label",
  );
  const customizeLabel = document.querySelector<HTMLElement>(
    "#header-customize-label",
  );
  if (previewLabel) previewLabel.textContent = "Preview";
  if (customizeLabel)
    customizeLabel.textContent = widgetEditMode ? "Done" : "Customize";
}

function waterlooWorksView(): string {
  return `<div class="view-wrap">${waterlooWorksController.render()}</div>`;
}

function isVisibleCalendarEvent(event: CalendarEvent): boolean {
  return workspaceController.isVisibleCalendarEvent(event);
}

function widgetData() {
  return {
    tasks: state.tasks,
    events: state.events.filter(isVisibleCalendarEvent),
    notes: state.notes,
    links: state.links,
    selectedDate,
    focusDurationMinutes: state.settings.focusDurationMinutes,
    taskManager: taskManagerRuntime,
    waterlooWorks: waterlooWorksController.widgetData(),
  };
}

function dashboardViewContext(): DashboardViewContext {
  return {
    state,
    now,
    selectedDate,
    widgetEditMode,
    phonePreview,
    registries,
    widgetData,
  };
}

function workspaceViewContext(): WorkspaceViewContext {
  return {
    state,
    now,
    selectedDate,
    calendarDate,
    taskFilter,
    focusDeskTaskStorageMessage: workspaceController.getTaskStorageMessage(),
    isVisibleCalendarEvent,
    googleCalendarCalendars:
      workspaceController.googleCalendar.getState().calendars,
  };
}

function settingsViewContext(): SettingsViewContext {
  const calendar = workspaceController.googleCalendar.getState();
  return {
    state,
    registries,
    googleCalendarConnected: calendar.connected,
    googleCalendarLastSyncAt: calendar.lastSyncAt,
    googleCalendarCalendars: calendar.calendars,
    googleCalendarMessage: calendar.message,
    googleCalendarBusy: calendar.busy,
    waterlooWorksEvaluatorStatus:
      waterlooWorksSettingsActions.getState().status,
    waterlooWorksEvaluatorMessage:
      waterlooWorksSettingsActions.getState().message,
    waterlooWorksEvaluatorSaving:
      waterlooWorksSettingsActions.getState().saving,
    nativeBridgeAvailable: isNativeBridgeAvailable(),
  };
}

function updateClocks(): void {
  const current = new Date();
  const time = new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(current);
  const date = new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(current);
  document
    .querySelectorAll<HTMLElement>("[data-live-clock]")
    .forEach((node) => (node.textContent = time));
  document
    .querySelectorAll<HTMLElement>("[data-live-date]")
    .forEach((node) => (node.textContent = date));
}

function openWidget(widgetId: string): void {
  dashboardActions.openWidget(widgetId);
}

function openWidgetPicker(): void {
  dashboardActions.openWidgetPicker();
}

function setWidgetDimension(widgetId: string, rawDimension: string): void {
  dashboardActions.setWidgetDimension(widgetId, rawDimension);
}

function toggleWidgetFromSettings(widgetId: string): void {
  dashboardActions.toggleWidgetFromSettings(widgetId);
}

function restoreDefaultDashboard(): void {
  dashboardActions.restoreDefaultDashboard();
}

function taskManagerCommand(command: string): void {
  taskManagerActions.command(command);
}

function taskManagerView(): string {
  return renderTaskManagerView({
    runtime: taskManagerRuntime,
    mode: taskManagerMode,
    progressView: taskManagerProgressView,
    todoDays: taskManagerTodoDays,
    statusMenuId: taskManagerStatusMenuId,
    commandMessage: taskManagerCommandMessage,
  });
}

function openEditor(
  type: "task" | "note" | "link" | "event",
  editId?: number,
): void {
  openWorkspaceEditor(
    {
      state,
      now,
      selectedDate,
      googleCalendarMessage:
        workspaceController.googleCalendar.getState().message,
      getFocusDeskTaskStorageMessage: workspaceController.getTaskStorageMessage,
      showModal,
      closeModal,
      render,
      persist: () => persist(),
      saveCalendarEvent: workspaceController.saveCalendarEvent,
      deleteCalendarEvent: workspaceController.deleteCalendarEvent,
      saveFocusDeskTask: workspaceController.saveTask,
    },
    type,
    editId,
  );
}

function openQuickTask(): void {
  openWorkspaceQuickTask({
    state,
    now,
    selectedDate,
    googleCalendarMessage:
      workspaceController.googleCalendar.getState().message,
    getFocusDeskTaskStorageMessage: workspaceController.getTaskStorageMessage,
    showModal,
    closeModal,
    render,
    persist: () => persist(),
    saveCalendarEvent: workspaceController.saveCalendarEvent,
    deleteCalendarEvent: workspaceController.deleteCalendarEvent,
    saveFocusDeskTask: workspaceController.saveTask,
  });
}

function openSearch(): void {
  workspaceModalActions.openSearch();
}

function openFocus(taskId: number): void {
  workspaceModalActions.openFocus(taskId);
}

function showModal(content: string): void {
  const modal = element<HTMLDivElement>(".modal");
  modal.classList.remove("widget-full-modal", "picker-modal");
  delete modal.dataset.widgetId;
  element<HTMLDivElement>("#modal-content").innerHTML = content;
  element<HTMLDivElement>("#modal").classList.remove("hidden");
  document
    .querySelectorAll<HTMLElement>("[data-modal-close]")
    .forEach((button) => (button.onclick = closeModal));
}

function closeModal(): void {
  element<HTMLDivElement>("#modal").classList.add("hidden");
  const modal = element<HTMLDivElement>(".modal");
  modal.classList.remove("widget-full-modal", "picker-modal");
  delete modal.dataset.widgetId;
  workspaceModalActions.stopTimer();
}

function refreshTaskManagerView(): void {
  taskManagerActions.refresh();
}

function taskManagerMutationAction(action: string, input: unknown): void {
  taskManagerActions.mutationAction(action, input);
}

function openTaskManagerCourseEditor(): void {
  taskManagerActions.openCourseEditor();
}

function openTaskManagerTaskEditor(): void {
  taskManagerActions.openTaskEditor();
}

function runTaskManagerMutation(
  action: "tasks.complete" | "tasks.reopen" | "tasks.delete",
  id: string,
  occurrenceDate?: string,
): void {
  taskManagerActions.runMutation(action, id, occurrenceDate);
}

function viewActionContext(): ViewActionContext {
  return {
    state,
    selectedDate,
    render,
    setTaskManagerStatusMenuId: (id) => {
      taskManagerStatusMenuId = id;
    },
    getTaskManagerStatusMenuId: () => taskManagerStatusMenuId,
    updateSetting,
    refreshTaskManager: refreshTaskManagerView,
    openTaskManagerCourseEditor,
    openTaskManagerTaskEditor,
    taskManagerCommand,
    toggleWidgetFromSettings,
    resetSettings,
    restoreDefaultDashboard,
    saveWaterlooWorksEvaluatorConfig: () =>
      void waterlooWorksSettingsActions.save(),
    connectGoogleCalendar: () =>
      void workspaceController.googleCalendar.connect(),
    refreshGoogleCalendar: () =>
      void workspaceController.googleCalendar.refresh(),
    disconnectGoogleCalendar: () =>
      void workspaceController.googleCalendar.disconnect(),
    setGoogleCalendarSelection: workspaceController.googleCalendar.setSelection,
    openEditor,
    openQuickTask,
    openNativeLink,
    runTaskManagerMutation,
    setTaskManagerStatus: (id: string, status: TaskManagerStatus) =>
      taskManagerMutationAction("tasks.update-task", { id, status }),
    saveFocusDeskTask: workspaceController.saveTask,
    deleteFocusDeskTask: workspaceController.deleteTask,
    openSearch,
    openFocus,
    toggleWidgets: () => {
      widgetEditMode = !widgetEditMode;
      phonePreview = false;
      render();
    },
    togglePreview: () => {
      phonePreview = !phonePreview;
      widgetEditMode = false;
      render();
    },
    addWidget: openWidgetPicker,
    setWidgetDimension,
    hideWidget: (widgetId) => {
      const widget = state.widgetLayout.instances.find(
        (item) => item.id === widgetId,
      );
      if (!widget) return;
      widget.visible = false;
      widget.updatedAt = new Date().toISOString();
      persist(true);
    },
    openWidget,
    refreshOpenWidget: dashboardActions.refreshOpenWidget,
    importCalendar: () => element<HTMLInputElement>("#ics-input").click(),
    selectDate: (date) => {
      selectedDate = date;
      view = "today";
      render();
    },
    previousMonth: () => {
      calendarDate.setMonth(calendarDate.getMonth() - 1);
      render();
    },
    nextMonth: () => {
      calendarDate.setMonth(calendarDate.getMonth() + 1);
      render();
    },
    calendarToday: () => {
      calendarDate = new Date(now.getFullYear(), now.getMonth(), 1);
      render();
    },
    getWidgetEditMode: () => widgetEditMode,
    persist: () => persist(),
  };
}

function bindViewActions(): void {
  bindViewBindings({
    featureActions: viewActionContext(),
    state,
    render,
    setView: (nextView) => {
      view = nextView;
    },
    setTaskFilter: (filter) => {
      taskFilter = filter;
    },
    setTaskManagerMode: (mode) => {
      taskManagerMode = mode;
      taskManagerStatusMenuId = undefined;
      taskManagerCommandMessage = "";
    },
    setTaskManagerProgressView: (progressView) => {
      taskManagerProgressView = progressView;
    },
    updateSetting,
    taskManagerCommand,
    refreshSettingsStatus: () =>
      void waterlooWorksSettingsActions.refreshStatus(),
    getSelectedDate: () => selectedDate,
    createQuickTask: (title, date) => {
      const task: Task = {
        id: Date.now(),
        title,
        done: false,
        tag: "Inbox",
        date,
        priority: "normal",
        recurrence: null,
        completedDates: [],
      };
      void workspaceController.saveTask(task).then(() => render());
    },
    setWidgetDimension,
    persist: () => persist(true),
  });
}

element<HTMLButtonElement>("#modal-close").onclick = closeModal;
element<HTMLDivElement>("#modal").onclick = (event) => {
  if ((event.target as HTMLElement).id === "modal") closeModal();
};
element<HTMLButtonElement>("#focus-search").onclick = openSearch;

element<HTMLInputElement>("#ics-input").onchange = (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const lines = String(reader.result)
      .replace(/\r/g, "")
      .replace(/\n[ \t]/g, "")
      .split("\n");
    let current: Partial<CalendarEvent> = {};
    for (const line of lines) {
      const separator = line.indexOf(":");
      const key = (separator >= 0 ? line.slice(0, separator) : line).split(
        ";",
      )[0];
      const value = separator >= 0 ? line.slice(separator + 1) : "";
      if (key === "SUMMARY")
        current.title = value.replace(/\\,/g, ",").replace(/\\n/g, " ");
      if (key === "DTSTART") {
        const raw = value.replace(/[^0-9TZ]/g, "");
        current.date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
        current.time = raw.includes("T")
          ? `${raw.slice(9, 11)}:${raw.slice(11, 13)}`
          : "ALL DAY";
      }
      if (
        key === "END" &&
        value === "VEVENT" &&
        current.title &&
        current.date
      ) {
        state.events.push({
          id: Date.now() + Math.random(),
          title: current.title,
          date: current.date,
          time: current.time,
          calendar: file.name,
          source: "ics",
        });
        current = {};
      }
    }
    input.value = "";
    persist();
  };
  reader.readAsText(file);
};

element<HTMLButtonElement>("#export-data").onclick = () => {
  const blob = new Blob(
    [JSON.stringify(appDatabase.createDocument(state), null, 2)],
    {
      type: "application/json",
    },
  );
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = "focusdesk-backup.json";
  anchor.click();
  URL.revokeObjectURL(anchor.href);
};

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const link = target.closest<HTMLAnchorElement>(".link-card");
  if (!link || !window.focusDesk) return;
  event.preventDefault();
  openNativeLink(link.getAttribute("href") ?? "");
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeModal();
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openSearch();
  }
});

void initializeNativeWorkspace()
  .then(() => workspaceController.initializeTasks())
  .then(() => refreshTaskManagerRuntime())
  .then(() => waterlooWorksController.initialize())
  .then(() => waterlooWorksSettingsActions.refreshStatus())
  .then(() => workspaceController.googleCalendar.syncOnStartup())
  .then(() => render());
render();
