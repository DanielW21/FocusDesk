import type { AppState } from "../../app/app-state";
import { publicEnvironment } from "../../config/public-environment";
import { isNativeBridgeAvailable } from "../../platform/native-bridge";
import type { CalendarEvent, Task } from "./model";
import type { FocusDeskTasksClient } from "./tasks-client";
import { reconcileGoogleCalendarSync } from "./calendar-sync";
import type {
  GoogleCalendarClient,
  GoogleCalendarConfiguration,
  GoogleCalendarSummary,
} from "./google-calendar-client";

const GOOGLE_CALENDAR_SELECTION_VERSION = 4;

export interface WorkspaceControllerContext {
  state: AppState;
  focusDeskTasksClient: FocusDeskTasksClient;
  googleCalendarClient: GoogleCalendarClient;
  save: () => void;
  render: () => void;
}

export interface GoogleCalendarUiState {
  connected: boolean;
  lastSyncAt: string;
  calendars: GoogleCalendarSummary[];
  message: string;
  busy: boolean;
}

export interface WorkspaceController {
  googleCalendar: {
    getState: () => GoogleCalendarUiState;
    loadList: () => Promise<void>;
    syncOnStartup: () => Promise<void>;
    connect: () => Promise<void>;
    refresh: () => Promise<void>;
    disconnect: () => Promise<void>;
    setSelection: (calendarId: string, selected: boolean) => void;
    resetSelection: () => void;
  };
  isVisibleCalendarEvent: (event: CalendarEvent) => boolean;
  purgeUnselectedGoogleEvents: () => void;
  saveCalendarEvent: (event: CalendarEvent) => Promise<void>;
  deleteCalendarEvent: (event: CalendarEvent) => Promise<boolean>;
  getTaskStorageMessage: () => string;
  saveTask: (task: Task) => Promise<boolean>;
  deleteTask: (taskId: number) => Promise<boolean>;
  initializeTasks: () => Promise<void>;
}

export function createWorkspaceController(
  context: WorkspaceControllerContext,
): WorkspaceController {
  const { state, focusDeskTasksClient, googleCalendarClient, save, render } =
    context;
  let taskStorageMessage = "";
  let googleCalendarSelectionInitialized = false;
  const googleCalendarState: GoogleCalendarUiState = {
    connected: false,
    lastSyncAt: "",
    calendars: [],
    message: "",
    busy: false,
  };

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
    save();
  }

  async function loadGoogleCalendarList(): Promise<void> {
    const configuration = googleCalendarConfiguration();
    if (!configuration) return;
    const result = await googleCalendarClient.calendars(configuration);
    googleCalendarState.calendars = result.calendars;
    initializeGoogleCalendarSelection(googleCalendarState.calendars);
  }

  async function pullGoogleCalendar(fullSync = false): Promise<void> {
    const configuration = googleCalendarConfiguration({ fullSync });
    if (!configuration || !isNativeBridgeAvailable()) return;
    const result = await googleCalendarClient.sync(configuration);
    googleCalendarState.connected = result.connected;
    if (!result.connected) return;
    state.events = reconcileGoogleCalendarSync(
      state.events,
      result,
      fullSync,
      state.settings.googleCalendarIds,
    );
    googleCalendarState.lastSyncAt =
      result.syncedAt ?? new Date().toISOString();
    save();
  }

  async function syncOnStartup(): Promise<void> {
    const configuration = googleCalendarConfiguration();
    if (
      !configuration ||
      !isNativeBridgeAvailable() ||
      !state.settings.googleCalendarAutoSync
    )
      return;

    try {
      const status = await googleCalendarClient.status(configuration);
      googleCalendarState.connected = status.connected;
      googleCalendarState.lastSyncAt = status.lastSyncAt ?? "";
      if (!status.connected) return;
      try {
        await loadGoogleCalendarList();
      } catch {
        googleCalendarState.message =
          "Connected, but calendar names are unavailable. Check the calendar-list permission in Settings.";
      }
      await pullGoogleCalendar(true);
    } catch {
      // Calendar sync is best-effort during startup; the local workspace stays usable.
    }
  }

  async function connect(): Promise<void> {
    const configuration = googleCalendarConfiguration();
    if (!configuration || !isNativeBridgeAvailable()) {
      googleCalendarState.message =
        "Google Calendar is available in the packaged FocusDesk app after a client ID is configured.";
      render();
      return;
    }
    googleCalendarState.busy = true;
    googleCalendarState.message = "Opening Google authorization…";
    render();
    try {
      const status = await googleCalendarClient.authorize(configuration);
      googleCalendarState.connected = status.connected;
      googleCalendarState.message = "";
      try {
        await loadGoogleCalendarList();
      } catch (error) {
        googleCalendarState.message =
          error instanceof Error
            ? `${error.message} Falling back to the primary calendar.`
            : "Calendar names are unavailable. Falling back to the primary calendar.";
      }
      await pullGoogleCalendar(true);
    } catch (error) {
      googleCalendarState.message =
        error instanceof Error
          ? error.message
          : "Google Calendar could not connect.";
    } finally {
      googleCalendarState.busy = false;
      render();
    }
  }

  async function refresh(): Promise<void> {
    const configuration = googleCalendarConfiguration();
    if (!configuration || !isNativeBridgeAvailable()) return;
    googleCalendarState.busy = true;
    googleCalendarState.message = "Syncing Google Calendar…";
    render();
    try {
      const status = await googleCalendarClient.status(configuration);
      googleCalendarState.connected = status.connected;
      if (!status.connected) {
        googleCalendarState.message = "Connect Google Calendar before syncing.";
        return;
      }
      try {
        await loadGoogleCalendarList();
      } catch {
        // The events scope can still sync the primary calendar.
      }
      await pullGoogleCalendar(true);
      googleCalendarState.message = "Google Calendar is up to date.";
    } catch (error) {
      googleCalendarState.message =
        error instanceof Error
          ? error.message
          : "Google Calendar could not sync.";
    } finally {
      googleCalendarState.busy = false;
      render();
    }
  }

  async function disconnect(): Promise<void> {
    if (!isNativeBridgeAvailable()) return;
    googleCalendarState.busy = true;
    render();
    try {
      await googleCalendarClient.disconnect();
      googleCalendarState.connected = false;
      googleCalendarState.calendars = [];
      googleCalendarState.lastSyncAt = "";
      googleCalendarState.message =
        "Disconnected. Local FocusDesk events were kept.";
      state.events = state.events.filter((event) => event.source !== "google");
      save();
    } catch (error) {
      googleCalendarState.message =
        error instanceof Error
          ? error.message
          : "Google Calendar could not disconnect.";
    } finally {
      googleCalendarState.busy = false;
      render();
    }
  }

  function setSelection(calendarId: string, selected: boolean): void {
    const current = new Set(state.settings.googleCalendarIds);
    if (selected) current.add(calendarId);
    else current.delete(calendarId);
    const nextIds = [...current];
    if (nextIds.length === 0) {
      googleCalendarState.message = "Select at least one calendar to sync.";
      render();
      return;
    }
    state.settings = {
      ...state.settings,
      googleCalendarIds: nextIds,
      googleCalendarSelectionVersion: GOOGLE_CALENDAR_SELECTION_VERSION,
      googleCalendarSelectionInitialized: true,
    };
    googleCalendarSelectionInitialized = true;
    if (!selected) {
      state.events = state.events.filter(
        (event) =>
          event.source !== "google" || event.googleCalendarId !== calendarId,
      );
    }
    save();
    void refresh();
  }

  function resetSelection(): void {
    googleCalendarSelectionInitialized = false;
  }

  function isVisibleCalendarEvent(event: CalendarEvent): boolean {
    return (
      !event.googleCalendarId ||
      state.settings.googleCalendarIds.includes(event.googleCalendarId)
    );
  }

  function purgeUnselectedGoogleEvents(): void {
    state.events = state.events.filter(
      (event) => event.source !== "google" || isVisibleCalendarEvent(event),
    );
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

  function taskStorageErrorMessage(error: unknown): string {
    return error instanceof Error
      ? error.message
      : "FocusDesk could not save this task.";
  }

  async function saveCalendarEvent(event: CalendarEvent): Promise<void> {
    replaceCalendarEvent(event);
    save();
    const configuration = googleCalendarConfiguration();
    if (
      !configuration ||
      !isNativeBridgeAvailable() ||
      !googleCalendarState.connected
    )
      return;

    try {
      const saved = event.googleEventId
        ? await googleCalendarClient.update(configuration, event)
        : await googleCalendarClient.create(configuration, event);
      replaceCalendarEvent(saved);
      save();
    } catch (error) {
      replaceCalendarEvent({
        ...event,
        syncStatus: "error",
        syncError:
          error instanceof Error
            ? error.message
            : "Google Calendar could not save this event.",
      });
      save();
      googleCalendarState.message =
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
        !googleCalendarState.connected
      ) {
        googleCalendarState.message =
          "Reconnect Google Calendar before deleting a synced event.";
        return false;
      }
      try {
        await googleCalendarClient.delete(configuration, event);
      } catch (error) {
        googleCalendarState.message =
          error instanceof Error
            ? error.message
            : "Google Calendar could not delete this event.";
        return false;
      }
    }
    state.events = state.events.filter((item) => item.id !== event.id);
    save();
    return true;
  }

  async function saveTask(task: Task): Promise<boolean> {
    try {
      const saved = await focusDeskTasksClient.save(task);
      replaceTask(saved);
      taskStorageMessage = "";
      save();
      return true;
    } catch (error) {
      if (!isNativeBridgeAvailable()) {
        replaceTask(task);
        save();
        return true;
      }
      taskStorageMessage = taskStorageErrorMessage(error);
      return false;
    }
  }

  async function deleteTask(taskId: number): Promise<boolean> {
    try {
      await focusDeskTasksClient.delete(taskId);
      state.tasks = state.tasks.filter((item) => item.id !== taskId);
      taskStorageMessage = "";
      save();
      return true;
    } catch (error) {
      if (!isNativeBridgeAvailable()) {
        state.tasks = state.tasks.filter((item) => item.id !== taskId);
        save();
        return true;
      }
      taskStorageMessage = taskStorageErrorMessage(error);
      return false;
    }
  }

  async function initializeTasks(): Promise<void> {
    try {
      const tasks = await focusDeskTasksClient.bootstrap(state.tasks);
      state.tasks = [...tasks];
      taskStorageMessage = "";
      save();
    } catch (error) {
      if (isNativeBridgeAvailable())
        taskStorageMessage = taskStorageErrorMessage(error);
    }
  }

  return {
    googleCalendar: {
      getState: () => googleCalendarState,
      loadList: loadGoogleCalendarList,
      syncOnStartup,
      connect,
      refresh,
      disconnect,
      setSelection,
      resetSelection,
    },
    isVisibleCalendarEvent,
    purgeUnselectedGoogleEvents,
    saveCalendarEvent,
    deleteCalendarEvent,
    getTaskStorageMessage: () => taskStorageMessage,
    saveTask,
    deleteTask,
    initializeTasks,
  };
}
