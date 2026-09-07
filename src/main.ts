import { createAppRegistries } from "./app/bootstrap";
import { FocusDeskDatabase } from "./app/app-database";
import {
  WidgetDimensionSchema,
  type WidgetDimension,
  type WidgetInstance,
  type WidgetLayoutDocument,
} from "./contracts/widgets";
import { createDefaultWidgetLayout } from "./features/workspace/default-layout";
import { createFocusDeskTasksClient } from "./features/workspace/tasks-client";
import type {
  CalendarEvent,
  Note,
  Priority,
  QuickLink,
  Task,
} from "./features/workspace/model";
import {
  isNativeBridgeAvailable,
  openNativeLink,
} from "./platform/native-bridge";
import {
  refreshTaskManagerRuntime,
  taskManagerRuntime,
} from "./features/tasks/runtime";
import {
  TASK_MANAGER_STATUS_LABELS,
  TaskManagerStatusSchema,
  type TaskManagerStatus,
  type TaskManagerTask,
} from "./features/tasks/model";
import {
  createWeeklySummary,
  type WeeklySummaryItem,
} from "./features/tasks/weekly-summary";
import {
  DEFAULT_QUICK_LINK_COLOR,
  quickLinkAccessibleLabel,
  quickLinkHoverText,
  quickLinkType,
  renderQuickLinkAsset,
} from "./features/workspace/quick-links";
import { WidgetLayoutStore } from "./widgets/widget-layout-store";
import { dimensionParts, visualRows } from "./widgets/widget-dimensions";
import {
  DEFAULT_FOCUSDESK_SETTINGS,
  FocusDeskAccentSchema,
  FocusDeskDensitySchema,
  FocusDeskProgressViewSchema,
  FocusDeskSettingsSchema,
  FocusDeskTaskManagerModeSchema,
  FocusDeskThemeSchema,
  parseFocusDeskSettings,
  type FocusDeskSettings,
} from "./settings";
import { publicEnvironment } from "./config/public-environment";
import {
  createGoogleCalendarClient,
  type GoogleCalendarConfiguration,
  type GoogleCalendarSummary,
} from "./features/workspace/google-calendar-client";
import { reconcileGoogleCalendarSync } from "./features/workspace/calendar-sync";

type View =
  | "today"
  | "tasks"
  | "taskmanager"
  | "calendar"
  | "notes"
  | "links"
  | "settings";
type TaskFilter = "all" | "active" | "done";
type TaskManagerMode = FocusDeskSettings["taskManagerMode"];
type TaskManagerProgressView = FocusDeskSettings["taskManagerProgressView"];

interface AppState {
  tasks: Task[];
  events: CalendarEvent[];
  notes: Note[];
  links: QuickLink[];
  widgetLayout: WidgetLayoutDocument;
  settings: FocusDeskSettings;
}

const registries = createAppRegistries();
const widgetLayoutStore = new WidgetLayoutStore(registries.widgets);
const appDatabase = new FocusDeskDatabase(localStorage);
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
let draggedWidgetId: string | undefined;
let clockInterval: number | undefined;
let timerInterval: number | undefined;
let timerSeconds = 25 * 60;
let focusDeskTaskStorageMessage = "";
let googleCalendarConnected = false;
let googleCalendarLastSyncAt = "";
let googleCalendarCalendars: GoogleCalendarSummary[] = [];
let googleCalendarMessage = "";
let googleCalendarBusy = false;
let googleCalendarSelectionInitialized = false;

const GOOGLE_CALENDAR_SELECTION_VERSION = 4;

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
    },
    {
      id: 2,
      title: "Plan the three most important things",
      done: true,
      tag: "Planning",
      date: localDate(now),
      time: "10:00",
      priority: "normal",
    },
  ],
  events: [],
  notes: [],
  links: [],
  widgetLayout: createDefaultWidgetLayout(),
  settings: { ...DEFAULT_FOCUSDESK_SETTINGS },
};

const state = loadState();
appDatabase.ensure(state);
let taskManagerMode: TaskManagerMode = state.settings.taskManagerMode;
let taskManagerProgressView: TaskManagerProgressView =
  state.settings.taskManagerProgressView;
let taskManagerTodoDays = state.settings.taskManagerTodoDays;
applySettings();

function loadState(): AppState {
  const saved = appDatabase.load(starterState);
  return {
    tasks: saved.tasks,
    events: saved.events,
    notes: saved.notes,
    links: saved.links,
    widgetLayout: widgetLayoutStore.load(
      saved.widgetLayout,
      createDefaultWidgetLayout(),
    ),
    settings: parseFocusDeskSettings(saved.settings),
  };
}

function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(date: string): Date {
  return new Date(`${date}T12:00:00`);
}

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

function formatShort(date: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
  }).format(parseDate(date));
}

function persist(layoutChanged = false): void {
  if (layoutChanged) state.widgetLayout.revision += 1;
  appDatabase.save(state);
  render();
}

function googleCalendarConfiguration(
  options: { fullSync?: boolean } = {},
): GoogleCalendarConfiguration | undefined {
  if (!publicEnvironment.googleClientId) return undefined;
  return {
    clientId: publicEnvironment.googleClientId,
    scopes: publicEnvironment.googleScopes,
    calendarId: state.settings.googleCalendarIds[0] ?? "primary",
    calendarIds: state.settings.googleCalendarIds,
    fullSync: options.fullSync,
  };
}

function initializeGoogleCalendarSelection(
  calendars: GoogleCalendarSummary[],
): void {
  if (
    state.settings.googleCalendarSelectionVersion >=
      GOOGLE_CALENDAR_SELECTION_VERSION ||
    googleCalendarSelectionInitialized ||
    calendars.length === 0
  )
    return;
  const firstCalendar = calendars[0];
  if (!firstCalendar) return;
  googleCalendarSelectionInitialized = true;
  const hasSelectionMetadata = calendars.some(
    (calendar) => calendar.selected !== undefined,
  );
  const selectedIds = calendars
    .filter((calendar) => calendar.selected)
    .map((calendar) => calendar.id);
  const existingIds = state.settings.googleCalendarIds.filter((id) =>
    calendars.some((calendar) => calendar.id === id),
  );
  const birthdayIds = calendars
    .filter((calendar) => {
      const summary = calendar.summary.toLowerCase();
      const id = calendar.id.toLowerCase();
      return (
        summary === "birthdays" || id.includes("contacts@group.v.calendar")
      );
    })
    .map((calendar) => calendar.id);
  const previouslySynced3BIds = calendars
    .filter(
      (calendar) =>
        calendar.summary.trim().toLowerCase() === "3b" &&
        state.events.some((event) => event.googleCalendarId === calendar.id),
    )
    .map((calendar) => calendar.id);
  const baseIds =
    hasSelectionMetadata &&
    selectedIds.length > 0 &&
    state.settings.googleCalendarSelectionVersion <
      GOOGLE_CALENDAR_SELECTION_VERSION
      ? selectedIds
      : existingIds;
  const nextIds = [
    ...new Set([...baseIds, ...birthdayIds, ...previouslySynced3BIds]),
  ];
  state.settings = {
    ...state.settings,
    googleCalendarIds: nextIds.length > 0 ? nextIds : [firstCalendar.id],
    googleCalendarSelectionInitialized: true,
    googleCalendarSelectionVersion: GOOGLE_CALENDAR_SELECTION_VERSION,
  };
  appDatabase.save(state);
}

async function loadGoogleCalendarList(): Promise<void> {
  const configuration = googleCalendarConfiguration();
  if (!configuration) return;
  const result = await googleCalendarClient.calendars(configuration);
  googleCalendarCalendars = result.calendars;
  initializeGoogleCalendarSelection(googleCalendarCalendars);
}

async function pullGoogleCalendar(fullSync = false): Promise<void> {
  const configuration = googleCalendarConfiguration({ fullSync });
  if (!configuration || !isNativeBridgeAvailable()) return;
  const result = await googleCalendarClient.sync(configuration);
  googleCalendarConnected = result.connected;
  if (!result.connected) return;
  const nextEvents = reconcileGoogleCalendarSync(
    state.events,
    result,
    fullSync,
    state.settings.googleCalendarIds,
  );
  state.events = nextEvents;
  googleCalendarLastSyncAt = result.syncedAt ?? new Date().toISOString();
  appDatabase.save(state);
}

async function syncGoogleCalendarOnStartup(): Promise<void> {
  const configuration = googleCalendarConfiguration();
  if (
    !configuration ||
    !isNativeBridgeAvailable() ||
    !state.settings.googleCalendarAutoSync
  )
    return;

  try {
    const status = await googleCalendarClient.status(configuration);
    googleCalendarConnected = status.connected;
    googleCalendarLastSyncAt = status.lastSyncAt ?? "";
    if (!status.connected) return;
    try {
      await loadGoogleCalendarList();
    } catch {
      // The events scope can still sync the primary calendar if calendar list
      // permission has not been granted yet.
      googleCalendarMessage =
        "Connected, but calendar names are unavailable. Check the calendar-list permission in Settings.";
    }
    await pullGoogleCalendar(true);
  } catch {
    // Calendar sync is intentionally best-effort during startup. The local
    // workspace remains usable when Google is disconnected or unavailable.
  }
}

async function connectGoogleCalendar(): Promise<void> {
  const configuration = googleCalendarConfiguration();
  if (!configuration || !isNativeBridgeAvailable()) {
    googleCalendarMessage =
      "Google Calendar is available in the packaged FocusDesk app after a client ID is configured.";
    render();
    return;
  }
  googleCalendarBusy = true;
  googleCalendarMessage = "Opening Google authorization…";
  render();
  try {
    const status = await googleCalendarClient.authorize(configuration);
    googleCalendarConnected = status.connected;
    googleCalendarMessage = "";
    try {
      await loadGoogleCalendarList();
    } catch (error) {
      googleCalendarMessage =
        error instanceof Error
          ? `${error.message} Falling back to the primary calendar.`
          : "Calendar names are unavailable. Falling back to the primary calendar.";
    }
    await pullGoogleCalendar(true);
  } catch (error) {
    googleCalendarMessage =
      error instanceof Error
        ? error.message
        : "Google Calendar could not connect.";
  } finally {
    googleCalendarBusy = false;
    render();
  }
}

async function refreshGoogleCalendar(): Promise<void> {
  const configuration = googleCalendarConfiguration();
  if (!configuration || !isNativeBridgeAvailable()) return;
  googleCalendarBusy = true;
  googleCalendarMessage = "Syncing Google Calendar…";
  render();
  try {
    const status = await googleCalendarClient.status(configuration);
    googleCalendarConnected = status.connected;
    if (!status.connected) {
      googleCalendarMessage = "Connect Google Calendar before syncing.";
      return;
    }
    try {
      await loadGoogleCalendarList();
    } catch {
      // The events scope can still sync the primary calendar.
    }
    await pullGoogleCalendar(true);
    googleCalendarMessage = "Google Calendar is up to date.";
  } catch (error) {
    googleCalendarMessage =
      error instanceof Error
        ? error.message
        : "Google Calendar could not sync.";
  } finally {
    googleCalendarBusy = false;
    render();
  }
}

async function disconnectGoogleCalendar(): Promise<void> {
  if (!isNativeBridgeAvailable()) return;
  googleCalendarBusy = true;
  render();
  try {
    await googleCalendarClient.disconnect();
    googleCalendarConnected = false;
    googleCalendarCalendars = [];
    googleCalendarLastSyncAt = "";
    googleCalendarMessage = "Disconnected. Local FocusDesk events were kept.";
    state.events = state.events.filter((event) => event.source !== "google");
    appDatabase.save(state);
  } catch (error) {
    googleCalendarMessage =
      error instanceof Error
        ? error.message
        : "Google Calendar could not disconnect.";
  } finally {
    googleCalendarBusy = false;
    render();
  }
}

function setGoogleCalendarSelection(
  calendarId: string,
  selected: boolean,
): void {
  const current = new Set(state.settings.googleCalendarIds);
  if (selected) current.add(calendarId);
  else current.delete(calendarId);
  const nextIds = [...current];
  if (nextIds.length === 0) {
    googleCalendarMessage = "Select at least one calendar to sync.";
    render();
    return;
  }
  state.settings = {
    ...state.settings,
    googleCalendarIds: nextIds,
    googleCalendarSelectionVersion: GOOGLE_CALENDAR_SELECTION_VERSION,
  };
  state.settings.googleCalendarSelectionInitialized = true;
  googleCalendarSelectionInitialized = true;
  appDatabase.save(state);
  void refreshGoogleCalendar();
}

function taskStorageErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "FocusDesk could not save this task.";
}

function replaceTask(task: Task): void {
  const exists = state.tasks.some((item) => item.id === task.id);
  state.tasks = exists
    ? state.tasks.map((item) => (item.id === task.id ? task : item))
    : [...state.tasks, task];
}

function replaceCalendarEvent(event: CalendarEvent): void {
  const exists = state.events.some((item) => item.id === event.id);
  state.events = exists
    ? state.events.map((item) => (item.id === event.id ? event : item))
    : [...state.events, event];
}

async function saveCalendarEvent(event: CalendarEvent): Promise<void> {
  replaceCalendarEvent(event);
  appDatabase.save(state);
  const configuration = googleCalendarConfiguration();
  if (!configuration || !isNativeBridgeAvailable() || !googleCalendarConnected)
    return;

  try {
    const saved = event.googleEventId
      ? await googleCalendarClient.update(configuration, event)
      : await googleCalendarClient.create(configuration, event);
    replaceCalendarEvent(saved);
    appDatabase.save(state);
  } catch (error) {
    replaceCalendarEvent({
      ...event,
      syncStatus: "error",
      syncError:
        error instanceof Error
          ? error.message
          : "Google Calendar could not save this event.",
    });
    appDatabase.save(state);
    googleCalendarMessage =
      error instanceof Error
        ? error.message
        : "Google Calendar could not save this event.";
  }
}

async function deleteCalendarEvent(event: CalendarEvent): Promise<boolean> {
  if (event.source !== "focusdesk") return false;

  const configuration = googleCalendarConfiguration();
  if (event.googleEventId) {
    if (
      !configuration ||
      !isNativeBridgeAvailable() ||
      !googleCalendarConnected
    ) {
      googleCalendarMessage =
        "Reconnect Google Calendar before deleting a synced event.";
      return false;
    }
    try {
      await googleCalendarClient.delete(configuration, event);
    } catch (error) {
      googleCalendarMessage =
        error instanceof Error
          ? error.message
          : "Google Calendar could not delete this event.";
      return false;
    }
  }

  state.events = state.events.filter((item) => item.id !== event.id);
  appDatabase.save(state);
  return true;
}

async function saveFocusDeskTask(task: Task): Promise<boolean> {
  try {
    const saved = await focusDeskTasksClient.save(task);
    replaceTask(saved);
    focusDeskTaskStorageMessage = "";
    appDatabase.save(state);
    return true;
  } catch (error) {
    if (!isNativeBridgeAvailable()) {
      replaceTask(task);
      appDatabase.save(state);
      return true;
    }
    focusDeskTaskStorageMessage = taskStorageErrorMessage(error);
    return false;
  }
}

async function deleteFocusDeskTask(taskId: number): Promise<boolean> {
  try {
    await focusDeskTasksClient.delete(taskId);
    state.tasks = state.tasks.filter((item) => item.id !== taskId);
    focusDeskTaskStorageMessage = "";
    appDatabase.save(state);
    return true;
  } catch (error) {
    if (!isNativeBridgeAvailable()) {
      state.tasks = state.tasks.filter((item) => item.id !== taskId);
      appDatabase.save(state);
      return true;
    }
    focusDeskTaskStorageMessage = taskStorageErrorMessage(error);
    return false;
  }
}

async function initializeFocusDeskTasks(): Promise<void> {
  try {
    const tasks = await focusDeskTasksClient.bootstrap(state.tasks);
    state.tasks = [...tasks];
    focusDeskTaskStorageMessage = "";
    appDatabase.save(state);
  } catch (error) {
    if (isNativeBridgeAvailable())
      focusDeskTaskStorageMessage = taskStorageErrorMessage(error);
  }
}

function applySettings(): void {
  document.documentElement.dataset.theme = state.settings.theme;
  document.documentElement.dataset.density = state.settings.density;
  document.documentElement.dataset.accent = state.settings.accent;
}

function updateSetting(key: keyof FocusDeskSettings, value: unknown): void {
  const parsed = FocusDeskSettingsSchema.safeParse({
    ...state.settings,
    [key]: value,
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
  googleCalendarSelectionInitialized = false;
  taskManagerMode = state.settings.taskManagerMode;
  taskManagerProgressView = state.settings.taskManagerProgressView;
  taskManagerTodoDays = state.settings.taskManagerTodoDays;
  applySettings();
  persist();
}

function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing UI element: ${selector}`);
  return found;
}

function weekDates(): Date[] {
  const anchor = parseDate(selectedDate);
  const sunday = new Date(anchor);
  sunday.setDate(anchor.getDate() - anchor.getDay());
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(sunday);
    date.setDate(sunday.getDate() + index);
    return date;
  });
}

function weekStrip(): string {
  return `<div class="week-strip">
    ${weekDates()
      .map((date) => {
        const key = localDate(date);
        const taskCount = state.tasks.filter(
          (task) => task.date === key && !task.done,
        ).length;
        return `<button class="week-day ${key === selectedDate ? "selected" : ""} ${key === localDate(now) ? "is-today" : ""}" data-action="select-date" data-date="${key}">
        <span>${new Intl.DateTimeFormat("en", { weekday: "short" }).format(date)}</span>
        <strong>${date.getDate()}</strong>
        <i class="day-marker ${taskCount ? "has-items" : ""}">${taskCount || ""}</i>
      </button>`;
      })
      .join("")}
  </div>`;
}

function render(): void {
  if (clockInterval) window.clearInterval(clockInterval);
  const root = element<HTMLDivElement>("#view-root");
  const labels: Record<View, string> = {
    today: "Today",
    tasks: "All tasks",
    taskmanager: "TaskManager",
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
    state.tasks.filter((task) => !task.done && task.date === localDate(now))
      .length,
  );

  const views: Record<View, () => string> = {
    today: todayView,
    tasks: tasksView,
    taskmanager: taskManagerView,
    calendar: calendarView,
    notes: notesView,
    links: linksView,
    settings: settingsView,
  };
  root.innerHTML = views[view]();
  bindViewActions();
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

function todayView(): string {
  return `<div class="view-wrap widget-dashboard-view">
    ${weekStrip()}
    ${widgetEditMode ? '<div class="edit-banner"><span class="wiggle-dot"></span><strong>Customize your space</strong><span>Drag to reorder · choose dimensions · hide what you do not need</span></div>' : ""}
    <div class="widget-stage ${phonePreview ? "phone-preview" : ""}">
      ${phonePreview ? '<div class="phone-status"><span>9:41</span><b>FocusDesk</b><span>● ◒</span></div>' : ""}
      <div class="widget-canvas">
        ${state.widgetLayout.instances
          .filter((widget) => widget.visible)
          .map(widgetCard)
          .join("")}
        ${widgetEditMode ? '<button class="empty-widget-slot" data-action="add-widget"><span>＋</span>Add a widget</button>' : ""}
      </div>
      ${phonePreview ? '<div class="phone-home-bar"></div>' : ""}
    </div>
  </div>`;
}

function widgetStyleKey(widgetId: string): string {
  const segments = widgetId.split(".");
  return segments[segments.length - 1] ?? widgetId;
}

function widgetData() {
  return {
    tasks: state.tasks,
    events: state.events,
    notes: state.notes,
    links: state.links,
    selectedDate,
    focusDurationMinutes: state.settings.focusDurationMinutes,
    taskManager: taskManagerRuntime,
  };
}

function renderWidgetBody(
  widget: WidgetInstance,
  requestedDimension = widget.dimension,
  settings = widget.settings,
): string {
  const definition = registries.widgets.require(widget.widgetId);
  const view =
    definition.views[requestedDimension] ??
    definition.views[definition.manifest.defaultDimension];
  if (!view)
    throw new Error(`Widget ${widget.widgetId} has no renderable view`);
  return view.render({ data: widgetData(), settings });
}

function dimensionLabel(dimension: WidgetDimension): string {
  return dimension.replace("x", "×");
}

function largestDimension(
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

function widgetCard(widget: WidgetInstance): string {
  const definition = registries.widgets.require(widget.widgetId);
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
    styleKey === "links"
      ? `<div class="widget-surface" data-action="open-widget" data-widget-id="${widget.id}" role="button" tabindex="0" aria-label="Open ${meta.title}">`
      : `<button class="widget-surface" data-action="open-widget" data-widget-id="${widget.id}" aria-label="Open ${meta.title}">`;
  const surfaceEnd = styleKey === "links" ? "</div>" : "</button>";
  return `<article class="desk-widget widget-${styleKey} dimension-${widget.dimension} ${widgetEditMode ? "editing" : ""}" data-widget-id="${widget.id}" data-widget-columns="${columns}" data-widget-rows="${rows}" style="--widget-columns:${columns};--widget-rows:${rows};" draggable="${widgetEditMode}">
    ${widgetEditMode ? `<div class="widget-edit-controls"><label class="sr-only" for="widget-dimension-${widget.id}">Choose widget dimensions</label><select id="widget-dimension-${widget.id}" class="widget-dimension-select" data-action="set-widget-dimension" data-widget-id="${widget.id}" title="Choose dimensions">${dimensionOptions}</select><button data-action="hide-widget" data-widget-id="${widget.id}" title="Hide widget">−</button></div><div class="drag-handle">••••••</div>` : ""}
    ${surface}
      <header class="widget-header"><span class="widget-symbol">${meta.icon}</span><span>${headerTitle}</span><i>↗</i></header>
      ${renderWidgetBody(widget)}
    ${surfaceEnd}
  </article>`;
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
  const widget = state.widgetLayout.instances.find(
    (item) => item.id === widgetId,
  );
  if (!widget) return;
  const meta = registries.widgets.require(widget.widgetId).manifest;
  const styleKey = widgetStyleKey(widget.widgetId);
  const tasks = state.tasks.filter((task) => task.date === selectedDate);
  const actionLabels: Partial<Record<string, string>> = {
    tasks: "Open all tasks",
    schedule: "Open calendar",
    notes: "Open notes",
    links: "Open links",
  };
  const detailBody =
    styleKey === "schedule"
      ? `<div class="detail-events schedule-detail-events">${eventsFor(selectedDate) || '<div class="empty">No events on this day.</div>'}</div>`
      : `<div class="widget-detail-body widget-${styleKey}">${renderWidgetBody(widget, largestDimension(meta.supportedDimensions), { ...widget.settings, taskManagerExpanded: styleKey === "task-manager" })}</div>`;

  showModal(`<div class="widget-detail">
    <div class="widget-detail-head"><div class="widget-detail-icon widget-${styleKey}">${meta.icon}</div><div><div class="modal-kicker">${meta.description}</div><h2>${meta.title}</h2></div></div>
    ${detailBody}
    ${styleKey === "tracker" || styleKey === "tasks" ? `<div class="detail-task-list">${taskList(tasks)}</div>` : ""}
    ${styleKey === "focus" ? `<button class="primary-button detail-primary" id="detail-focus">Start a ${state.settings.focusDurationMinutes} minute session</button>` : ""}
    ${actionLabels[styleKey] ? `<button class="secondary-button detail-primary" id="detail-navigate">${actionLabels[styleKey]}</button>` : ""}
  </div>`);
  element<HTMLDivElement>(".modal").classList.add("widget-full-modal");
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
      const target: Partial<Record<string, View>> = {
        tasks: "tasks",
        schedule: "calendar",
        notes: "notes",
        links: "links",
      };
      view = target[styleKey] ?? "today";
      closeModal();
      render();
    };
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
  element<HTMLDivElement>(".modal").classList.add("picker-modal");
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
        appDatabase.save(state);
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
  state.widgetLayout = createDefaultWidgetLayout();
  persist(true);
}

function taskList(tasks: Task[]): string {
  if (!tasks.length)
    return '<div class="empty"><span class="empty-icon">✓</span>Nothing here yet. Enjoy the breathing room.</div>';
  return `<div class="task-list">${tasks
    .map(
      (task) => `
    <div class="task ${task.done ? "done" : ""}" data-id="${task.id}">
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

function tasksView(): string {
  const tasks = state.tasks
    .filter((task) =>
      taskFilter === "active"
        ? !task.done
        : taskFilter === "done"
          ? task.done
          : true,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  return `<div class="view-wrap">
    <div class="title-row"><div><p class="eyebrow">Everything in one place</p><h1>All tasks</h1><p class="date-line">${state.tasks.filter((task) => !task.done).length} things still in motion</p></div><button class="primary-button" data-action="add-task">＋ Add task</button></div>
    ${focusDeskTaskStorageMessage ? `<div class="integration-state"><strong>Task database unavailable</strong><span>${escapeHtml(focusDeskTaskStorageMessage)}</span></div>` : ""}
    <div class="filter-row">${(["all", "active", "done"] as TaskFilter[]).map((filter) => `<button class="filter ${taskFilter === filter ? "active" : ""}" data-filter="${filter}">${{ all: "All tasks", active: "Open", done: "Completed" }[filter]}</button>`).join("")}</div>
    <div class="panel">${taskList(tasks)}</div>
  </div>`;
}

function taskManagerDeadline(deadline: string | null): string {
  if (!deadline) return "No deadline";
  const parsed = new Date(deadline);
  if (Number.isNaN(parsed.getTime())) return "No deadline";
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function taskManagerCommand(command: string): void {
  const [name, rawDays] = command.trim().toLowerCase().split(/\s+/);
  const aliases: Record<string, TaskManagerMode> = {
    list: "list",
    ls: "list",
    fulllist: "fulllist",
    fl: "fulllist",
    exams: "exams",
    e: "exams",
    progress: "progress",
    p: "progress",
    todo: "todo",
    t: "todo",
  };
  const mode = name ? aliases[name] : undefined;
  if (!mode) {
    taskManagerCommandMessage =
      "Commands: list, fulllist, exams, progress, todo [days]";
    render();
    return;
  }
  if (mode === "todo") {
    const days = rawDays === undefined ? 7 : Number(rawDays);
    if (!Number.isInteger(days) || days < 0) {
      taskManagerCommandMessage = "Usage: todo [non-negative days]";
      render();
      return;
    }
    taskManagerTodoDays = days;
  }
  taskManagerCommandMessage = "";
  taskManagerMode = mode;
  render();
}

function taskManagerCourseTaskDate(task: TaskManagerTask): string {
  if (!task.deadline) return task.recurrence ? "Weekly" : "No deadline";
  const parsed = new Date(task.deadline);
  if (Number.isNaN(parsed.getTime())) return "No deadline";
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
  }).format(parsed);
}

function taskManagerStatusControl(
  task: TaskManagerTask,
  menuKey = task.id,
): string {
  const status = task.status ?? "none";
  const label = TASK_MANAGER_STATUS_LABELS[status];
  const options: Array<{ value: TaskManagerStatus; label: string }> = [
    { value: "none", label: "No status" },
    { value: "in-progress", label: "In Progress" },
    { value: "ready-to-submit", label: "Ready to Submit" },
    { value: "important", label: "Important" },
  ];
  const menu =
    taskManagerStatusMenuId === menuKey
      ? `<div class="task-manager-status-menu" role="menu">${options
          .map(
            (option) =>
              `<button class="${option.value === status ? "selected" : ""}" data-action="taskmanager-set-status" data-status="${option.value}" role="menuitem">${escapeHtml(option.label)}</button>`,
          )
          .join("")}</div>`
      : "";
  return `<div class="task-manager-status-control"><button class="task-manager-status ${status}" data-action="taskmanager-open-status" aria-label="Set task status" title="Set status"><i></i><span>${escapeHtml(status === "none" ? "Tag" : label)}</span></button>${menu}</div>`;
}

function weeklySummaryRange(start: string, end: string): string {
  const format = (value: string, includeMonth: boolean): string => {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("en-CA", {
      ...(includeMonth ? { month: "short" as const } : {}),
      day: "numeric",
    }).format(new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, 12));
  };
  return `${format(start, true)} – ${format(end, true)}`;
}

function taskManagerWeeklyRow(
  item: WeeklySummaryItem,
  customDateLabel?: string,
): string {
  const task = item.task;
  const [year, month, day] = item.dueDate.split("-").map(Number);
  const dueLabel =
    customDateLabel ??
    new Intl.DateTimeFormat("en-CA", {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, 12));
  return `<div class="task-manager-row" data-taskmanager-id="${escapeHtml(task.id)}" data-taskmanager-key="${escapeHtml(item.key)}" data-taskmanager-completed="false"${item.occurrenceDate ? ` data-taskmanager-occurrence="${item.occurrenceDate}"` : ""}>
    <button class="check" data-action="taskmanager-toggle" aria-label="Complete task"></button>
    <div class="task-manager-copy"><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(task.courseName)} · ${escapeHtml(dueLabel)}${item.occurrenceDate ? " · repeats weekly" : ""}</span></div>
    <span class="tag task-manager-priority">${task.isExam ? "Exam" : task.priority}</span>
    ${taskManagerStatusControl(task, item.key)}
    <button class="delete" data-action="taskmanager-delete" aria-label="Delete task">×</button>
  </div>`;
}

function taskManagerWeeklySummary(records: readonly TaskManagerTask[]): string {
  const summary = createWeeklySummary(records, new Date());
  const weeks = summary.weeks
    .map(
      (
        week,
        index,
      ) => `<section class="task-manager-week ${index === 0 ? "current" : ""}">
        <header><div><span>${index === 0 ? "Up next" : "Week"}</span><h2>${escapeHtml(weeklySummaryRange(week.weekStart, week.weekEnd))}</h2></div><b>${week.items.length} ${week.items.length === 1 ? "todo" : "todos"}</b></header>
        <div>${week.items.map((item) => taskManagerWeeklyRow(item)).join("")}</div>
      </section>`,
    )
    .join("");
  const unscheduled = summary.unscheduled.length
    ? `<section class="task-manager-week"><header><div><span>Anytime</span><h2>No date yet</h2></div><b>${summary.unscheduled.length} ${summary.unscheduled.length === 1 ? "todo" : "todos"}</b></header><div>${summary.unscheduled
        .map((task) =>
          taskManagerWeeklyRow(
            {
              key: task.id,
              task,
              dueDate: new Date().toISOString().slice(0, 10),
            },
            "Any day",
          ),
        )
        .join("")}</div></section>`
    : "";
  if (!weeks && !unscheduled)
    return '<div class="empty"><span class="empty-icon">✓</span>Your weekly list is clear.</div>';
  return `<div class="task-manager-weeks">${weeks}${unscheduled}</div>`;
}

function taskManagerCourseProgress(
  records: readonly TaskManagerTask[],
  detailed = false,
): string {
  const courses = new Map<
    string,
    {
      name: string;
      total: number;
      completed: number;
      weight: number;
      completedWeight: number;
      tasks: TaskManagerTask[];
    }
  >();
  for (const task of records) {
    const course = courses.get(task.courseId) ?? {
      name: task.courseName,
      total: 0,
      completed: 0,
      weight: 0,
      completedWeight: 0,
      tasks: [],
    };
    course.total += 1;
    course.weight += task.weight;
    course.tasks.push(task);
    if (task.completed) {
      course.completed += 1;
      course.completedWeight += task.weight;
    }
    courses.set(task.courseId, course);
  }
  if (!courses.size)
    return '<div class="empty"><span class="empty-icon">◔</span>No courses in TaskManager yet.</div>';
  return `<div class="task-manager-courses ${detailed ? "detailed" : ""}">${[
    ...courses.values(),
  ]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((course) => {
      const percent = course.weight
        ? (course.completedWeight / course.weight) * 100
        : (course.completed / course.total) * 100;
      const tasks = detailed
        ? `<div class="task-manager-course-tasks">${course.tasks
            .map(
              (task) =>
                `<div class="task-manager-course-task ${task.completed ? "done" : ""}"><span>${escapeHtml(task.title)}</span><small>${escapeHtml(taskManagerCourseTaskDate(task))}</small></div>`,
            )
            .join("")}</div>`
        : "";
      return `<article class="task-manager-course ${detailed ? "detailed" : ""}"><div class="task-manager-course-heading"><div><strong>${escapeHtml(course.name)}</strong><span>${course.completed}/${course.total} tasks complete</span></div><b>${percent.toFixed(0)}%</b></div><div class="progress-track"><i style="width:${Math.min(100, Math.max(0, percent))}%"></i></div>${tasks}</article>`;
    })
    .join("")}</div>`;
}

function taskManagerView(): string {
  const runtime = taskManagerRuntime;
  if (runtime.status !== "ready") {
    const title =
      runtime.status === "loading"
        ? "Loading FocusDesk tasks"
        : runtime.status === "unavailable"
          ? "Task database unavailable"
          : "Task database needs attention";
    const message =
      runtime.status === "loading"
        ? "Reading courses and tasks from SQLite…"
        : (runtime.message ?? "FocusDesk could not read its task database.");
    return `<div class="view-wrap"><div class="title-row"><div><p class="eyebrow">Built into FocusDesk</p><h1>TaskManager</h1><p class="date-line">Your courses and tasks are stored in FocusDesk.</p></div><div class="calendar-tools"><button class="secondary-button" data-action="taskmanager-refresh">↻ Refresh</button></div></div><div class="panel integration-panel"><div class="integration-state"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span></div></div></div>`;
  }

  const allRecords = [...runtime.records].sort((a, b) => {
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return a.deadline.localeCompare(b.deadline);
  });
  const nowTime = Date.now();
  const cutoff = nowTime + taskManagerTodoDays * 24 * 60 * 60 * 1000;
  const records = allRecords.filter((task) => {
    if (taskManagerMode === "list") return !task.completed;
    if (taskManagerMode === "exams") return task.isExam && !task.completed;
    if (taskManagerMode === "todo") {
      return (
        !task.completed &&
        !!task.deadline &&
        new Date(task.deadline).getTime() <= cutoff
      );
    }
    return true;
  });
  const openCount = allRecords.filter((task) => !task.completed).length;
  const title = {
    list: "Open tasks",
    fulllist: "All tasks",
    exams: "Upcoming exams",
    progress: "Progress",
    todo: `Due in ${taskManagerTodoDays} days`,
  }[taskManagerMode];
  const content =
    taskManagerMode === "progress"
      ? taskManagerCourseProgress(
          allRecords,
          taskManagerProgressView === "detailed",
        )
      : taskManagerMode === "list"
        ? taskManagerWeeklySummary(allRecords)
        : records.length
          ? records
              .map(
                (
                  task,
                ) => `<div class="task-manager-row ${task.completed ? "done" : ""}" data-taskmanager-id="${escapeHtml(task.id)}" data-taskmanager-completed="${task.completed}">
            <button class="check" data-action="taskmanager-toggle" aria-label="${task.completed ? "Reopen" : "Complete"} task">${task.completed ? "✓" : ""}</button>
            <div class="task-manager-copy"><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(task.courseName)} · ${escapeHtml(taskManagerDeadline(task.deadline))}</span></div>
            <span class="tag task-manager-priority">${task.isExam ? "Exam" : task.priority}</span>
            ${taskManagerStatusControl(task)}
            <button class="delete" data-action="taskmanager-delete" aria-label="Delete task">×</button>
          </div>`,
              )
              .join("")
          : '<div class="empty"><span class="empty-icon">✓</span>No tasks match this view.</div>';

  const progressViewControls =
    taskManagerMode === "progress"
      ? `<div class="task-manager-progress-controls" aria-label="Progress layout"><span>Layout</span>${(
          ["compact", "detailed"] as TaskManagerProgressView[]
        )
          .map(
            (layout) =>
              `<button class="filter ${taskManagerProgressView === layout ? "active" : ""}" data-taskmanager-progress-view="${layout}">${layout === "compact" ? "Compact" : "Detailed"}</button>`,
          )
          .join("")}</div>`
      : "";
  return `<div class="view-wrap"><div class="title-row"><div><p class="eyebrow">Built into FocusDesk</p><h1>TaskManager</h1><p class="date-line">${title} · ${openCount} open · ${allRecords.length} total</p></div><div class="calendar-tools"><button class="primary-button" data-action="taskmanager-add-task">＋ Task</button><button class="secondary-button" data-action="taskmanager-add-course">＋ Course</button><button class="secondary-button" data-action="taskmanager-refresh">↻ Refresh</button></div></div><div class="task-manager-command-row"><input class="text-input" id="taskmanager-command" placeholder="Run a TaskManager command… (list, exams, progress, todo 7)"><button class="secondary-button" data-action="taskmanager-run-command">Run</button></div>${taskManagerCommandMessage ? `<p class="form-error">${escapeHtml(taskManagerCommandMessage)}</p>` : ""}<div class="task-manager-modes">${(["list", "fulllist", "exams", "progress", "todo"] as TaskManagerMode[]).map((mode) => `<button class="filter ${taskManagerMode === mode ? "active" : ""}" data-taskmanager-mode="${mode}">${{ list: "Open", fulllist: "All", exams: "Exams", progress: "Progress", todo: "Todo" }[mode]}</button>`).join("")}</div>${progressViewControls}<div class="panel task-manager-panel">${content}</div></div>`;
}

function eventsFor(date: string): string {
  return state.events
    .filter(
      (event) =>
        event.date === date &&
        (!event.googleCalendarId ||
          state.settings.googleCalendarIds.includes(event.googleCalendarId)),
    )
    .map(
      (event) =>
        `<div class="event ${event.source === "focusdesk" ? "event-editable" : ""} ${event.source === "google" ? "google-event" : ""}"${calendarEventStyle(event)} ${event.source === "focusdesk" ? `data-action="edit-calendar-event" data-id="${event.id}" role="button" tabindex="0"` : ""}><div class="event-time">${escapeHtml(event.time || "ALL DAY")}</div><div class="event-body"><div class="event-title">${escapeHtml(event.title)}</div><div class="event-sub">${escapeHtml(event.calendar || (event.source === "google" ? "Google Calendar" : "Imported calendar"))}${event.source === "focusdesk" ? " · editable" : " · read-only"}</div></div></div>`,
    )
    .join("");
}

function calendarView(): string {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const days = new Date(year, month + 1, 0).getDate();
  const start = new Date(year, month, 1).getDay();
  let cells = '<div class="day-cell muted-cell"></div>'.repeat(start);
  for (let day = 1; day <= days; day += 1) {
    const date = localDate(new Date(year, month, day));
    const events = state.events.filter(
      (event) =>
        event.date === date &&
        (!event.googleCalendarId ||
          state.settings.googleCalendarIds.includes(event.googleCalendarId)),
    );
    const tasks = state.tasks.filter((task) => task.date === date);
    cells += `<div class="day-cell ${date === localDate(now) ? "today-cell" : ""}"><button class="day-num ${date === localDate(now) ? "today-num" : ""}" data-action="select-date" data-date="${date}">${day}</button>${events.map((event) => `<div class="cal-event ${event.source === "focusdesk" ? "focusdesk-event" : "google-event"}"${calendarEventStyle(event)} ${event.source === "focusdesk" ? `data-action="edit-calendar-event" data-id="${event.id}" role="button" tabindex="0" title="Edit ${escapeHtml(event.title)}"` : `title="${escapeHtml(event.title)} · read-only"`}>${escapeHtml(event.title)}</div>`).join("")}${tasks.map((task) => `<div class="cal-event task-event">${task.done ? "✓ " : ""}${escapeHtml(task.title)}</div>`).join("")}</div>`;
  }
  return `<div class="view-wrap"><div class="title-row"><div><p class="eyebrow">Plan with perspective</p><h1>Calendar</h1><p class="date-line">Google events are read-only. FocusDesk events can be added and edited here.</p></div><div class="calendar-tools"><button class="secondary-button" data-action="import-ics">＋ Import .ics</button><button class="secondary-button" data-action="google-calendar-sync">↻ Sync</button><button class="primary-button" data-action="add-calendar-event">＋ Event</button><button class="secondary-button" data-action="add-task">＋ Task</button></div></div><div class="panel calendar-panel"><div class="calendar-head"><h2>${new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(calendarDate)}</h2><div class="calendar-nav"><button data-action="prev-month">‹</button><button data-action="calendar-today">Today</button><button data-action="next-month">›</button></div></div><div class="calendar-grid">${["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((day) => `<div class="day-name">${day}</div>`).join("")}${cells}</div></div></div>`;
}

function notesView(): string {
  return `<div class="view-wrap"><div class="title-row"><div><p class="eyebrow">A place to think</p><h1>Scratch notes</h1><p class="date-line">Loose thoughts are welcome here.</p></div><button class="primary-button" data-action="add-note">＋ New note</button></div><div class="note-grid">${state.notes.length ? state.notes.map((note) => `<article class="note-card"><div class="card-actions"><button data-action="delete-note" data-id="${note.id}">×</button></div><h3>${escapeHtml(note.title)}</h3><p>${escapeHtml(note.body)}</p><div class="card-meta">${formatShort(note.date)}</div></article>`).join("") : '<div class="empty large-empty"><span class="empty-icon">✎</span>Your scratch space is clear.<br>Capture an idea whenever it arrives.</div>'}</div></div>`;
}

function linksView(): string {
  return `<div class="view-wrap"><div class="title-row"><div><h1>Quick links</h1></div><button class="primary-button" data-action="add-link">＋ Add link</button></div><div class="link-grid">${state.links.length ? state.links.map((link) => `<a class="link-card" href="${escapeHtml(link.url)}" aria-label="${escapeHtml(quickLinkAccessibleLabel(link))}" title="${escapeHtml(quickLinkHoverText(link))}"><div class="link-card-heading">${renderQuickLinkAsset(link, "link-card-asset")}<div><div class="link-type">${quickLinkType(link.url)}</div><h3>${escapeHtml(link.title)}</h3></div></div><div class="card-actions"><button data-action="edit-link" data-id="${link.id}" aria-label="Edit ${escapeHtml(link.title)}">✎</button><button data-action="delete-link" data-id="${link.id}" aria-label="Delete ${escapeHtml(link.title)}">×</button></div></a>`).join("") : '<div class="empty large-empty"><span class="empty-icon">↗</span>No quick links yet.<br>Add a folder, file, or website.</div>'}</div></div>`;
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

function googleCalendarEventColor(event: CalendarEvent): string | undefined {
  if (event.source !== "google" || !event.googleCalendarId) return undefined;
  const calendar = googleCalendarCalendars.find(
    (item) => item.id === event.googleCalendarId,
  );
  if (calendar) return googleCalendarColor(calendar);
  let hash = 0;
  for (const character of event.googleCalendarId) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return GOOGLE_CALENDAR_FALLBACK_COLORS[
    Math.abs(hash) % GOOGLE_CALENDAR_FALLBACK_COLORS.length
  ];
}

function calendarEventStyle(event: CalendarEvent): string {
  const color = googleCalendarEventColor(event);
  return color ? ` style="--calendar-event-color:${color}"` : "";
}

function settingsView(): string {
  const widgetRows = registries.widgets
    .list()
    .map((definition) => {
      const meta = definition.manifest;
      const styleKey = widgetStyleKey(meta.id);
      const current = state.widgetLayout.instances.find(
        (item) => item.widgetId === meta.id,
      );
      const selectedDimension = current?.dimension ?? meta.defaultDimension;
      const dimensions = meta.supportedDimensions
        .map(
          (dimension) =>
            `<option value="${dimension}" ${dimension === selectedDimension ? "selected" : ""}>${dimensionLabel(dimension)}</option>`,
        )
        .join("");
      return `<div class="settings-tool-row"><div class="settings-tool-info"><span class="settings-tool-icon widget-${styleKey}">${meta.icon}</span><div><strong>${escapeHtml(meta.title)}</strong><small>${escapeHtml(meta.description)}</small></div></div><div class="settings-tool-controls"><label class="settings-dimension"><span>Size</span><select data-action="settings-widget-dimension" data-widget-id="${escapeHtml(meta.id)}" aria-label="${escapeHtml(meta.title)} size">${dimensions}</select></label><button class="settings-toggle ${current?.visible ? "active" : ""}" data-action="settings-toggle-widget" data-widget-id="${escapeHtml(meta.id)}" aria-pressed="${current?.visible ? "true" : "false"}">${current?.visible ? "Shown" : "Hidden"}</button></div></div>`;
    })
    .join("");
  const todoDays = [
    ...new Set([1, 3, 7, 14, 30, 60, 90, state.settings.taskManagerTodoDays]),
  ]
    .sort((a, b) => a - b)
    .map(
      (days) =>
        `<option value="${days}" ${state.settings.taskManagerTodoDays === days ? "selected" : ""}>${days} day${days === 1 ? "" : "s"}</option>`,
    )
    .join("");
  const googleCalendarStatus = !publicEnvironment.googleClientId
    ? "Client ID not configured"
    : googleCalendarConnected
      ? "Connected"
      : "Not connected";
  const googleCalendarRows = googleCalendarConnected
    ? googleCalendarCalendars.length
      ? googleCalendarCalendars
          .map((calendar) => {
            const checked = state.settings.googleCalendarIds.includes(
              calendar.id,
            );
            const eventCount = state.events.filter(
              (event) => event.googleCalendarId === calendar.id,
            ).length;
            return `<label class="google-calendar-row"><input type="checkbox" data-action="google-calendar-toggle" data-calendar-id="${escapeHtml(calendar.id)}" ${checked ? "checked" : ""} ${googleCalendarBusy ? "disabled" : ""}><span class="google-calendar-color" style="--google-calendar-color:${googleCalendarColor(calendar)}"></span><span class="google-calendar-copy"><strong>${escapeHtml(calendar.summary)}</strong><small>${calendar.primary ? "Primary calendar" : escapeHtml(calendar.accessRole ?? "Google Calendar")} · ${eventCount} synced event${eventCount === 1 ? "" : "s"}</small></span></label>`;
          })
          .join("")
      : '<p class="settings-empty">No calendars were returned by Google yet.</p>'
    : '<p class="settings-empty">Connect Google Calendar to choose which calendars appear in FocusDesk.</p>';
  const googleCalendarSyncLabel = googleCalendarLastSyncAt
    ? `Last sync ${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(googleCalendarLastSyncAt))}`
    : "Not synced yet";

  return `<div class="view-wrap settings-view">
    <div class="title-row"><div><p class="eyebrow">Make it yours</p><h1>Settings</h1><p class="date-line">Tune FocusDesk and each tool to fit the way you work.</p></div><button class="secondary-button" data-action="settings-reset">Reset settings</button></div>
    <div class="settings-layout">
      <section class="settings-section settings-section-wide"><div class="settings-section-heading"><div><span class="settings-section-icon">◌</span><div><h2>Appearance</h2><p>Set the overall feel of your workspace.</p></div></div><span class="settings-saved">Saved locally</span></div><div class="settings-control-grid">
        <label class="settings-field"><span>Theme</span><small>Choose how FocusDesk looks.</small><select data-setting="theme"><option value="light" ${state.settings.theme === "light" ? "selected" : ""}>Light</option><option value="dark" ${state.settings.theme === "dark" ? "selected" : ""}>Dark</option></select></label>
        <label class="settings-field"><span>Accent color</span><small>Used for actions and highlights.</small><select data-setting="accent"><option value="coral" ${state.settings.accent === "coral" ? "selected" : ""}>Coral</option><option value="sage" ${state.settings.accent === "sage" ? "selected" : ""}>Sage</option><option value="blue" ${state.settings.accent === "blue" ? "selected" : ""}>Blue</option><option value="gold" ${state.settings.accent === "gold" ? "selected" : ""}>Gold</option></select></label>
        <label class="settings-field"><span>Interface density</span><small>Adjust spacing across views and cards.</small><select data-setting="density"><option value="compact" ${state.settings.density === "compact" ? "selected" : ""}>Compact</option><option value="comfortable" ${state.settings.density === "comfortable" ? "selected" : ""}>Comfortable</option><option value="spacious" ${state.settings.density === "spacious" ? "selected" : ""}>Spacious</option></select></label>
      </div></section>
      <section class="settings-section"><div class="settings-section-heading"><div><span class="settings-section-icon">↯</span><div><h2>TaskManager</h2><p>Choose its starting view and progress layout.</p></div></div></div><div class="settings-field-stack">
        <label class="settings-field"><span>Initial view</span><small>Used when you open TaskManager.</small><select data-setting="taskManagerMode"><option value="list" ${state.settings.taskManagerMode === "list" ? "selected" : ""}>Open tasks</option><option value="fulllist" ${state.settings.taskManagerMode === "fulllist" ? "selected" : ""}>All tasks</option><option value="exams" ${state.settings.taskManagerMode === "exams" ? "selected" : ""}>Upcoming exams</option><option value="progress" ${state.settings.taskManagerMode === "progress" ? "selected" : ""}>Progress</option><option value="todo" ${state.settings.taskManagerMode === "todo" ? "selected" : ""}>Todo</option></select></label>
        <label class="settings-field"><span>Progress layout</span><small>Compact cards or the two-column task view.</small><select data-setting="taskManagerProgressView"><option value="compact" ${state.settings.taskManagerProgressView === "compact" ? "selected" : ""}>Compact</option><option value="detailed" ${state.settings.taskManagerProgressView === "detailed" ? "selected" : ""}>Detailed</option></select></label>
        <label class="settings-field"><span>Todo window</span><small>How far ahead the Todo view looks.</small><select data-setting="taskManagerTodoDays">${todoDays}</select></label>
      </div></section>
      <section class="settings-section"><div class="settings-section-heading"><div><span class="settings-section-icon">◎</span><div><h2>Focus timer</h2><p>Set the length of a focused work session.</p></div></div></div><div class="settings-field-stack">
        <label class="settings-field"><span>Session length</span><small>Used by the Focus widget and timer.</small><select data-setting="focusDurationMinutes"><option value="15" ${state.settings.focusDurationMinutes === 15 ? "selected" : ""}>15 minutes</option><option value="25" ${state.settings.focusDurationMinutes === 25 ? "selected" : ""}>25 minutes</option><option value="45" ${state.settings.focusDurationMinutes === 45 ? "selected" : ""}>45 minutes</option><option value="60" ${state.settings.focusDurationMinutes === 60 ? "selected" : ""}>60 minutes</option><option value="90" ${state.settings.focusDurationMinutes === 90 ? "selected" : ""}>90 minutes</option></select></label>
      </div></section>
      <section class="settings-section settings-section-wide"><div class="settings-section-heading"><div><span class="settings-section-icon">▣</span><div><h2>Google Calendar</h2><p>Pull selected calendars into FocusDesk and push FocusDesk events back to Google.</p></div></div><span class="settings-saved">${escapeHtml(googleCalendarStatus)}</span></div><div class="google-calendar-toolbar"><div><strong>${escapeHtml(googleCalendarSyncLabel)}</strong><small>${escapeHtml(googleCalendarMessage || (googleCalendarConnected ? "Selected calendars sync incrementally and are safe to refresh." : "Your Google refresh token stays in macOS Keychain."))}</small></div><div class="settings-tool-controls"><button class="${googleCalendarConnected ? "secondary-button" : "primary-button"}" data-action="google-calendar-connect" ${googleCalendarBusy || !publicEnvironment.googleClientId ? "disabled" : ""}>${googleCalendarConnected ? "Reconnect" : "Connect Google"}</button>${googleCalendarConnected ? `<button class="secondary-button" data-action="google-calendar-sync" ${googleCalendarBusy ? "disabled" : ""}>↻ Sync now</button><button class="secondary-button" data-action="google-calendar-disconnect" ${googleCalendarBusy ? "disabled" : ""}>Disconnect</button>` : ""}</div></div><label class="google-calendar-auto-sync"><input type="checkbox" data-action="google-calendar-auto-sync" ${state.settings.googleCalendarAutoSync ? "checked" : ""}><span><strong>Sync on app startup</strong><small>Refresh selected calendars when FocusDesk opens.</small></span></label><div class="google-calendar-list-heading"><strong>Calendars</strong><small>Checked calendars are pulled into the Calendar view.</small></div><div class="google-calendar-list">${googleCalendarRows}</div></section>
      <section class="settings-section"><div class="settings-section-heading"><div><span class="settings-section-icon">✦</span><div><h2>Dashboard tools</h2><p>Show, hide, and resize every widget from one place.</p></div></div></div><div class="settings-tool-list">${widgetRows}</div><button class="secondary-button settings-restore" data-action="settings-restore-dashboard">Restore default dashboard</button></section>
    </div>
  </div>`;
}

function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error ?? new Error("Unable to read image"));
    reader.readAsDataURL(file);
  });
}

function openEditor(
  type: "task" | "note" | "link" | "event",
  editId?: number,
): void {
  const task =
    type === "task" && editId
      ? state.tasks.find((item) => item.id === editId)
      : undefined;
  const link =
    type === "link" && editId
      ? state.links.find((item) => item.id === editId)
      : undefined;
  const event =
    type === "event" && editId
      ? state.events.find((item) => item.id === editId)
      : undefined;
  const forms = {
    task: [
      "Task",
      `<div class="form-group"><label>What needs doing?</label><input class="text-input" id="f-title" value="${escapeHtml(task?.title ?? "")}" placeholder="e.g. Draft project outline"></div><div class="form-row"><div class="form-group"><label>Date</label><input class="text-input" id="f-date" type="date" value="${task?.date ?? selectedDate}"></div><div class="form-group"><label>Time</label><input class="text-input" id="f-time" type="time" value="${task?.time ?? ""}"></div></div><div class="form-row"><div class="form-group"><label>Category</label><input class="text-input" id="f-tag" value="${escapeHtml(task?.tag ?? "")}" placeholder="Work, personal…"></div><div class="form-group"><label>Priority</label><select class="select-input" id="f-priority"><option value="normal">Normal</option><option value="high" ${task?.priority === "high" ? "selected" : ""}>High</option><option value="low" ${task?.priority === "low" ? "selected" : ""}>Low</option></select></div></div>`,
    ],
    note: [
      "Scratch note",
      '<div class="form-group"><label>Title</label><input class="text-input" id="f-title" placeholder="A thought worth keeping"></div><div class="form-group"><label>Note</label><textarea class="note-textarea" id="f-body" rows="7" placeholder="Write freely…"></textarea></div>',
    ],
    link: [
      "Quick link",
      `<div class="form-group"><label>Name</label><input class="text-input" id="f-title" value="${escapeHtml(link?.title ?? "")}" placeholder="Google Drive"></div><div class="form-group"><label>URL or local path</label><input class="text-input" id="f-url" value="${escapeHtml(link?.url ?? "")}" placeholder="https://… or /Users/…"></div><div class="form-group"><label>Colour</label><input class="color-input" id="f-color" type="color" value="${link?.color ?? DEFAULT_QUICK_LINK_COLOR}"></div><div class="form-group"><label>Icon image</label><input class="text-input" id="f-asset-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"><small class="form-hint">Choose an image up to 2 MB${link?.asset ? ". Leave empty to keep the current icon." : ""}</small></div>`,
    ],
    event: [
      "Calendar event",
      `<div class="form-group"><label>Title</label><input class="text-input" id="f-title" value="${escapeHtml(event?.title ?? "")}" placeholder="e.g. Design review"></div><div class="form-row"><div class="form-group"><label>Date</label><input class="text-input" id="f-date" type="date" value="${event?.date ?? selectedDate}"></div><div class="form-group"><label>Time</label><input class="text-input" id="f-time" type="time" value="${event?.time ?? ""}"></div></div><small class="form-hint">FocusDesk events are pushed to the first selected Google calendar when connected.</small>`,
    ],
  }[type];

  showModal(
    `<div class="modal-kicker">${editId ? "EDIT" : "NEW"}</div><h2>${forms[0]}</h2>${forms[1]}${type === "event" && event ? '<small class="form-hint calendar-delete-error" id="calendar-delete-error" role="alert"></small>' : ""}<div class="modal-footer">${type === "event" && event ? '<button class="danger-button" id="delete-calendar-event">Delete event</button>' : ""}<span class="modal-footer-spacer"></span><button class="secondary-button" data-modal-close>Cancel</button><button class="primary-button" id="save-modal">${editId ? "Save changes" : "Add to FocusDesk"}</button></div>`,
  );
  element<HTMLInputElement>("#f-title").focus();
  if (type === "event" && event) {
    element<HTMLButtonElement>("#delete-calendar-event").onclick = async () => {
      const deleteButton = element<HTMLButtonElement>("#delete-calendar-event");
      const deleteError = element<HTMLElement>("#calendar-delete-error");
      if (deleteButton.dataset.confirm !== "true") {
        deleteButton.dataset.confirm = "true";
        deleteButton.textContent = "Confirm delete";
        deleteError.textContent = event.googleEventId
          ? "Click again to delete this event from FocusDesk and Google Calendar."
          : "Click again to delete this event from FocusDesk.";
        return;
      }
      const saveButton = element<HTMLButtonElement>("#save-modal");
      deleteButton.disabled = true;
      saveButton.disabled = true;
      if (await deleteCalendarEvent(event)) {
        closeModal();
        render();
        return;
      }
      deleteButton.disabled = false;
      saveButton.disabled = false;
      deleteButton.dataset.confirm = "";
      deleteButton.textContent = "Delete event";
      deleteError.textContent =
        googleCalendarMessage || "FocusDesk could not delete this event.";
    };
  }
  element<HTMLButtonElement>("#save-modal").onclick = async () => {
    const title = element<HTMLInputElement>("#f-title").value.trim();
    if (!title) return;
    if (type === "task") {
      const value: Task = {
        id: task?.id ?? Date.now(),
        title,
        done: task?.done ?? false,
        date: element<HTMLInputElement>("#f-date").value || selectedDate,
        time: element<HTMLInputElement>("#f-time").value,
        tag: element<HTMLInputElement>("#f-tag").value || "Task",
        priority: element<HTMLSelectElement>("#f-priority").value as Priority,
      };
      if (!(await saveFocusDeskTask(value))) {
        render();
        return;
      }
    }
    if (type === "note")
      state.notes.push({
        id: Date.now(),
        title,
        body: element<HTMLTextAreaElement>("#f-body").value,
        date: localDate(now),
      });
    if (type === "link") {
      const assetFile = element<HTMLInputElement>("#f-asset-file").files?.[0];
      if (assetFile && assetFile.size > 2 * 1024 * 1024) {
        window.alert("Please choose an image smaller than 2 MB.");
        return;
      }
      let asset = link?.asset;
      if (assetFile) asset = await readImageFile(assetFile);
      const value: QuickLink = {
        id: link?.id ?? Date.now(),
        title,
        url: element<HTMLInputElement>("#f-url").value.trim(),
        asset,
        color: element<HTMLInputElement>("#f-color").value,
      };
      state.links = link
        ? state.links.map((item) => (item.id === link.id ? value : item))
        : [...state.links, value];
    }
    if (type === "event") {
      const value: CalendarEvent = {
        ...event,
        id: event?.id ?? Date.now(),
        title,
        date: element<HTMLInputElement>("#f-date").value || selectedDate,
        time: element<HTMLInputElement>("#f-time").value || undefined,
        calendar:
          event?.calendar ?? state.settings.googleCalendarIds[0] ?? "primary",
        source: "focusdesk",
        syncStatus: "pending",
        syncError: undefined,
      };
      await saveCalendarEvent(value);
    }
    closeModal();
    if (type !== "task" && type !== "event") persist();
    else render();
  };
}

function openSearch(): void {
  showModal(
    `<div class="search-box"><span>⌕</span><input id="search-input" placeholder="Search tasks, notes, and links…" autocomplete="off"><kbd>esc</kbd></div><div id="search-results" class="search-results"><div class="search-hint">Start typing to search your workspace</div></div>`,
  );
  const input = element<HTMLInputElement>("#search-input");
  input.focus();
  input.oninput = () => {
    const query = input.value.trim().toLowerCase();
    const results = element<HTMLDivElement>("#search-results");
    if (!query) {
      results.innerHTML =
        '<div class="search-hint">Start typing to search your workspace</div>';
      return;
    }
    const matches = [
      ...state.tasks
        .filter((item) => item.title.toLowerCase().includes(query))
        .map((item) => ({
          type: "Task",
          title: item.title,
          detail: `${formatShort(item.date)} · ${item.tag}`,
        })),
      ...state.notes
        .filter((item) =>
          `${item.title} ${item.body}`.toLowerCase().includes(query),
        )
        .map((item) => ({
          type: "Note",
          title: item.title,
          detail: item.body.slice(0, 70),
        })),
      ...state.links
        .filter((item) =>
          `${item.title} ${item.url}`.toLowerCase().includes(query),
        )
        .map((item) => ({ type: "Link", title: item.title, detail: item.url })),
    ];
    results.innerHTML = matches.length
      ? matches
          .map(
            (match) =>
              `<div class="search-result"><span>${match.type}</span><div><strong>${escapeHtml(match.title)}</strong><small>${escapeHtml(match.detail)}</small></div></div>`,
          )
          .join("")
      : '<div class="search-hint">No matches found</div>';
  };
}

function openFocus(taskId: number): void {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  timerSeconds = state.settings.focusDurationMinutes * 60;
  const initialMinutes = String(state.settings.focusDurationMinutes).padStart(
    2,
    "0",
  );
  showModal(
    `<div class="focus-modal"><div class="modal-kicker">FOCUS SESSION</div><p id="timer-display">${initialMinutes}:00</p><h2>${escapeHtml(task.title)}</h2><span>Everything else can wait.</span><div class="focus-controls"><button class="secondary-button" data-modal-close>Not now</button><button class="primary-button" id="timer-toggle">Start timer</button></div></div>`,
  );
  const toggle = element<HTMLButtonElement>("#timer-toggle");
  toggle.onclick = () => {
    if (timerInterval) {
      window.clearInterval(timerInterval);
      timerInterval = undefined;
      toggle.textContent = "Resume";
      return;
    }
    toggle.textContent = "Pause";
    timerInterval = window.setInterval(() => {
      timerSeconds -= 1;
      const minutes = Math.floor(timerSeconds / 60)
        .toString()
        .padStart(2, "0");
      const seconds = (timerSeconds % 60).toString().padStart(2, "0");
      const display = document.querySelector("#timer-display");
      if (display) display.textContent = `${minutes}:${seconds}`;
      if (timerSeconds <= 0 && timerInterval) {
        window.clearInterval(timerInterval);
        timerInterval = undefined;
        toggle.textContent = "Complete";
      }
    }, 1000);
  };
}

function showModal(content: string): void {
  element<HTMLDivElement>(".modal").classList.remove(
    "widget-full-modal",
    "picker-modal",
  );
  element<HTMLDivElement>("#modal-content").innerHTML = content;
  element<HTMLDivElement>("#modal").classList.remove("hidden");
  document
    .querySelectorAll<HTMLElement>("[data-modal-close]")
    .forEach((button) => (button.onclick = closeModal));
}

function closeModal(): void {
  element<HTMLDivElement>("#modal").classList.add("hidden");
  element<HTMLDivElement>(".modal").classList.remove(
    "widget-full-modal",
    "picker-modal",
  );
  if (timerInterval) window.clearInterval(timerInterval);
  timerInterval = undefined;
}

function refreshTaskManagerView(): void {
  void refreshTaskManagerRuntime().then(() => render());
}

function taskManagerMutationAction(action: string, input: unknown): void {
  void registries.actions
    .invoke(action, input, { source: "ui" })
    .then(() => refreshTaskManagerRuntime())
    .then(() => render())
    .catch((error: unknown) => {
      taskManagerRuntime.status = "error";
      taskManagerRuntime.message =
        error instanceof Error ? error.message : "TaskManager action failed.";
      render();
    });
}

function openTaskManagerCourseEditor(): void {
  showModal(
    `<div class="modal-kicker">TASKMANAGER</div><h2>New course</h2><div class="form-group"><label>Course name</label><input class="text-input" id="tm-course-name" placeholder="e.g. BME 362"></div><div class="modal-footer"><button class="secondary-button" data-modal-close>Cancel</button><button class="primary-button" id="tm-save-course">Add course</button></div>`,
  );
  element<HTMLInputElement>("#tm-course-name").focus();
  element<HTMLButtonElement>("#tm-save-course").onclick = () => {
    const name = element<HTMLInputElement>("#tm-course-name").value.trim();
    if (!name) return;
    closeModal();
    taskManagerMutationAction("tasks.create-course", { name });
  };
}

function openTaskManagerTaskEditor(): void {
  if (!taskManagerRuntime.courses.length) {
    openTaskManagerCourseEditor();
    return;
  }
  const options = taskManagerRuntime.courses
    .map(
      (course) =>
        `<option value="${escapeHtml(course.id)}">${escapeHtml(course.name)}</option>`,
    )
    .join("");
  showModal(
    `<div class="modal-kicker">TASKMANAGER</div><h2>New task</h2><div class="form-group"><label>Course</label><select class="select-input" id="tm-course">${options}</select></div><div class="form-group"><label>Task title</label><input class="text-input" id="tm-title" placeholder="e.g. Lab report"></div><div class="form-row"><div class="form-group"><label>Deadline</label><input class="text-input" id="tm-deadline" type="datetime-local"></div><div class="form-group"><label>Weight</label><input class="text-input" id="tm-weight" type="number" min="0" step="0.25" value="0"></div></div><div class="form-row"><div class="form-group"><label>Priority</label><select class="select-input" id="tm-priority"><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select></div><div class="form-group"><label>Status</label><select class="select-input" id="tm-status"><option value="none">No status</option><option value="in-progress">In Progress</option><option value="ready-to-submit">Ready to Submit</option><option value="important">Important</option></select></div></div><label class="check-field"><input id="tm-exam" type="checkbox"> Exam</label><div class="modal-footer"><button class="secondary-button" data-modal-close>Cancel</button><button class="primary-button" id="tm-save-task">Add task</button></div>`,
  );
  element<HTMLInputElement>("#tm-title").focus();
  element<HTMLButtonElement>("#tm-save-task").onclick = () => {
    const title = element<HTMLInputElement>("#tm-title").value.trim();
    const weight = Number(element<HTMLInputElement>("#tm-weight").value || 0);
    if (!title || !Number.isFinite(weight) || weight < 0) return;
    const rawDeadline = element<HTMLInputElement>("#tm-deadline").value;
    const deadline = rawDeadline ? new Date(rawDeadline).toISOString() : null;
    const input = {
      courseId: element<HTMLSelectElement>("#tm-course").value,
      title,
      weight,
      deadline,
      priority: element<HTMLSelectElement>("#tm-priority").value,
      status: element<HTMLSelectElement>("#tm-status").value,
      isExam: element<HTMLInputElement>("#tm-exam").checked,
    };
    closeModal();
    taskManagerMutationAction("tasks.create-task", input);
  };
}

function runTaskManagerMutation(
  action: "tasks.complete" | "tasks.reopen" | "tasks.delete",
  id: string,
  occurrenceDate?: string,
): void {
  const input =
    action === "tasks.delete"
      ? { id, confirm: true as const }
      : { id, ...(occurrenceDate ? { occurrenceDate } : {}) };
  void registries.actions
    .invoke(action, input, { source: "ui" })
    .then(() => refreshTaskManagerRuntime())
    .then(() => render())
    .catch((error: unknown) => {
      taskManagerRuntime.status = "error";
      taskManagerRuntime.message =
        error instanceof Error ? error.message : "TaskManager action failed.";
      render();
    });
}

function bindViewActions(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(
    (button) =>
      (button.onclick = () => {
        view = button.dataset.view as View;
        render();
      }),
  );
  document.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach(
    (button) =>
      (button.onclick = () => {
        taskFilter = button.dataset.filter as TaskFilter;
        render();
      }),
  );
  document
    .querySelectorAll<HTMLButtonElement>("[data-taskmanager-mode]")
    .forEach(
      (button) =>
        (button.onclick = () => {
          taskManagerMode = button.dataset.taskmanagerMode as TaskManagerMode;
          taskManagerStatusMenuId = undefined;
          taskManagerCommandMessage = "";
          render();
        }),
    );
  document
    .querySelectorAll<HTMLButtonElement>("[data-taskmanager-progress-view]")
    .forEach(
      (button) =>
        (button.onclick = () => {
          taskManagerProgressView = button.dataset
            .taskmanagerProgressView as TaskManagerProgressView;
          render();
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
        updateSetting(key, value);
      }),
  );
  document
    .querySelectorAll<HTMLSelectElement>(
      'select[data-action="settings-widget-dimension"]',
    )
    .forEach(
      (select) =>
        (select.onchange = () => {
          if (select.dataset.widgetId)
            setWidgetDimension(select.dataset.widgetId, select.value);
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
        taskManagerCommand(taskManagerCommandInput.value);
    };
  }
  document.querySelectorAll<HTMLElement>("[data-action]:not(select)").forEach(
    (control) =>
      (control.onclick = (event) => {
        const action = control.dataset.action;
        if (action === "taskmanager-refresh") {
          refreshTaskManagerView();
          return;
        }
        if (action === "taskmanager-add-course") {
          openTaskManagerCourseEditor();
          return;
        }
        if (action === "taskmanager-add-task") {
          openTaskManagerTaskEditor();
          return;
        }
        if (action === "taskmanager-run-command") {
          const command = document.querySelector<HTMLInputElement>(
            "#taskmanager-command",
          );
          if (command) taskManagerCommand(command.value);
          return;
        }
        if (action === "settings-toggle-widget") {
          if (control.dataset.widgetId)
            toggleWidgetFromSettings(control.dataset.widgetId);
          return;
        }
        if (action === "settings-reset") {
          resetSettings();
          return;
        }
        if (action === "settings-restore-dashboard") {
          restoreDefaultDashboard();
          return;
        }
        if (action === "google-calendar-connect") {
          void connectGoogleCalendar();
          return;
        }
        if (action === "google-calendar-sync") {
          void refreshGoogleCalendar();
          return;
        }
        if (action === "google-calendar-disconnect") {
          void disconnectGoogleCalendar();
          return;
        }
        if (action === "google-calendar-auto-sync") {
          updateSetting(
            "googleCalendarAutoSync",
            (control as HTMLInputElement).checked,
          );
          return;
        }
        if (action === "google-calendar-toggle") {
          const calendarId = control.dataset.calendarId;
          if (calendarId)
            setGoogleCalendarSelection(
              calendarId,
              (control as HTMLInputElement).checked,
            );
          return;
        }
        if (action === "add-calendar-event") {
          openEditor("event");
          return;
        }
        if (action === "edit-calendar-event") {
          const calendarEvent = state.events.find(
            (item) => item.id === Number(control.dataset.id),
          );
          if (calendarEvent?.source === "focusdesk")
            openEditor("event", calendarEvent.id);
          return;
        }
        if (action === "open-quick-link") {
          event.preventDefault();
          event.stopPropagation();
          const link = state.links.find(
            (item) => item.id === Number(control.dataset.linkId),
          );
          if (link) openNativeLink(link.url);
          return;
        }
        if (action === "taskmanager-open-status") {
          event.stopPropagation();
          const row = control.closest<HTMLElement>("[data-taskmanager-id]");
          const taskManagerId = row?.dataset.taskmanagerId;
          const taskManagerKey = row?.dataset.taskmanagerKey ?? taskManagerId;
          if (!taskManagerId) return;
          taskManagerStatusMenuId =
            taskManagerStatusMenuId === taskManagerKey
              ? undefined
              : taskManagerKey;
          render();
          return;
        }
        if (action === "taskmanager-set-status") {
          event.stopPropagation();
          const row = control.closest<HTMLElement>("[data-taskmanager-id]");
          const taskManagerId = row?.dataset.taskmanagerId;
          const status = TaskManagerStatusSchema.safeParse(
            control.dataset.status,
          );
          if (!taskManagerId || !status.success) return;
          taskManagerStatusMenuId = undefined;
          taskManagerMutationAction("tasks.update-task", {
            id: taskManagerId,
            status: status.data,
          });
          return;
        }
        if (
          action === "taskmanager-toggle" ||
          action === "taskmanager-delete"
        ) {
          const row = control.closest<HTMLElement>("[data-taskmanager-id]");
          const taskManagerId = row?.dataset.taskmanagerId;
          if (!taskManagerId) return;
          if (
            action === "taskmanager-delete" &&
            !window.confirm("Delete this TaskManager task?")
          )
            return;
          if (action === "taskmanager-delete") {
            runTaskManagerMutation("tasks.delete", taskManagerId);
          } else {
            const completed = row.dataset.taskmanagerCompleted === "true";
            runTaskManagerMutation(
              completed ? "tasks.reopen" : "tasks.complete",
              taskManagerId,
              row.dataset.taskmanagerOccurrence,
            );
          }
          return;
        }
        const id = Number(
          control.closest<HTMLElement>("[data-id]")?.dataset.id ??
            control.dataset.id,
        );
        const task = state.tasks.find((item) => item.id === id);
        if (action === "toggle-task" && task) {
          void saveFocusDeskTask({ ...task, done: !task.done }).then(() =>
            render(),
          );
        }
        if (action === "delete-task" && task) {
          void deleteFocusDeskTask(id).then(() => render());
        }
        if (action === "edit-task" && task) openEditor("task", id);
        if (action === "edit-link") {
          event.preventDefault();
          event.stopPropagation();
          const linkId = Number(control.dataset.id);
          if (state.links.some((item) => item.id === linkId))
            openEditor("link", linkId);
          return;
        }
        if (action === "delete-note") {
          state.notes = state.notes.filter(
            (item) => item.id !== Number(control.dataset.id),
          );
          persist();
        }
        if (action === "delete-link") {
          event.preventDefault();
          event.stopPropagation();
          state.links = state.links.filter(
            (item) => item.id !== Number(control.dataset.id),
          );
          persist();
        }
        if (action === "add-task") openEditor("task");
        if (action === "add-note") openEditor("note");
        if (action === "add-link") openEditor("link");
        if (action === "open-search") openSearch();
        if (action === "start-focus") openFocus(id);
        if (action === "toggle-widgets") {
          widgetEditMode = !widgetEditMode;
          phonePreview = false;
          render();
        }
        if (action === "toggle-preview") {
          phonePreview = !phonePreview;
          widgetEditMode = false;
          render();
        }
        if (action === "add-widget") openWidgetPicker();
        if (action === "set-widget-dimension" && control.dataset.widgetId)
          setWidgetDimension(
            control.dataset.widgetId,
            (control as HTMLSelectElement).value,
          );
        if (action === "hide-widget" && control.dataset.widgetId) {
          const widget = state.widgetLayout.instances.find(
            (item) => item.id === control.dataset.widgetId,
          );
          if (widget) {
            widget.visible = false;
            widget.updatedAt = new Date().toISOString();
            persist(true);
          }
        }
        if (
          action === "open-widget" &&
          control.dataset.widgetId &&
          !widgetEditMode
        )
          openWidget(control.dataset.widgetId);
        if (action === "import-ics")
          element<HTMLInputElement>("#ics-input").click();
        if (action === "select-date" && control.dataset.date) {
          selectedDate = control.dataset.date;
          view = "today";
          render();
        }
        if (action === "prev-month") {
          calendarDate.setMonth(calendarDate.getMonth() - 1);
          render();
        }
        if (action === "next-month") {
          calendarDate.setMonth(calendarDate.getMonth() + 1);
          render();
        }
        if (action === "calendar-today") {
          calendarDate = new Date(now.getFullYear(), now.getMonth(), 1);
          render();
        }
      }),
  );

  document
    .querySelectorAll<HTMLSelectElement>(
      'select[data-action="set-widget-dimension"]',
    )
    .forEach(
      (select) =>
        (select.onchange = () => {
          if (select.dataset.widgetId)
            setWidgetDimension(select.dataset.widgetId, select.value);
        }),
    );

  const quickTask = document.querySelector<HTMLInputElement>("#quick-task");
  if (quickTask)
    quickTask.onkeydown = (event) => {
      if (event.key !== "Enter" || !quickTask.value.trim()) return;
      const task: Task = {
        id: Date.now(),
        title: quickTask.value.trim(),
        done: false,
        tag: "Inbox",
        date: selectedDate,
        priority: "normal",
      };
      void saveFocusDeskTask(task).then(() => render());
    };

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
        const from = state.widgetLayout.instances.findIndex(
          (item) => item.id === draggedWidgetId,
        );
        const to = state.widgetLayout.instances.findIndex(
          (item) => item.id === targetId,
        );
        if (from < 0 || to < 0) return;
        const [moved] = state.widgetLayout.instances.splice(from, 1);
        if (!moved) return;
        state.widgetLayout.instances.splice(to, 0, moved);
        const timestamp = new Date().toISOString();
        state.widgetLayout.instances.forEach((item, order) => {
          item.order = order;
          item.updatedAt = timestamp;
        });
        draggedWidgetId = undefined;
        persist(true);
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

void initializeFocusDeskTasks()
  .then(() => refreshTaskManagerRuntime())
  .then(() => syncGoogleCalendarOnStartup())
  .then(() => render());
render();
