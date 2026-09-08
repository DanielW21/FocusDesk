import type { AppState } from "./app-state";
import type { Task } from "../features/workspace/model";
import type { FocusDeskSettings } from "../settings";
import {
  TaskManagerStatusSchema,
  type TaskManagerStatus,
} from "../features/tasks/model";

type TaskManagerMutation = "tasks.complete" | "tasks.reopen" | "tasks.delete";

export interface ViewActionContext {
  state: AppState;
  render: () => void;
  setTaskManagerStatusMenuId: (id: string | undefined) => void;
  getTaskManagerStatusMenuId: () => string | undefined;
  updateSetting: (key: keyof FocusDeskSettings, value: unknown) => void;
  refreshTaskManager: () => void;
  openTaskManagerCourseEditor: () => void;
  openTaskManagerTaskEditor: () => void;
  taskManagerCommand: (command: string) => void;
  toggleWidgetFromSettings: (widgetId: string) => void;
  resetSettings: () => void;
  restoreDefaultDashboard: () => void;
  saveWaterlooWorksEvaluatorConfig: () => void;
  connectGoogleCalendar: () => void;
  refreshGoogleCalendar: () => void;
  disconnectGoogleCalendar: () => void;
  setGoogleCalendarSelection: (calendarId: string, selected: boolean) => void;
  openEditor: (type: "task" | "note" | "link" | "event", id?: number) => void;
  openNativeLink: (url: string) => void;
  runTaskManagerMutation: (
    action: TaskManagerMutation,
    id: string,
    occurrenceDate?: string,
  ) => void;
  setTaskManagerStatus: (id: string, status: TaskManagerStatus) => void;
  saveFocusDeskTask: (task: Task) => Promise<boolean>;
  deleteFocusDeskTask: (id: number) => Promise<boolean>;
  openSearch: () => void;
  openFocus: (taskId: number) => void;
  toggleWidgets: () => void;
  togglePreview: () => void;
  addWidget: () => void;
  setWidgetDimension: (widgetId: string, dimension: string) => void;
  hideWidget: (widgetId: string) => void;
  openWidget: (widgetId: string) => void;
  importCalendar: () => void;
  selectDate: (date: string) => void;
  previousMonth: () => void;
  nextMonth: () => void;
  calendarToday: () => void;
  getWidgetEditMode: () => boolean;
  persist: () => void;
}

export function bindViewActions(context: ViewActionContext): void {
  document.querySelectorAll<HTMLElement>("[data-action]:not(select)").forEach(
    (control) =>
      (control.onclick = (event) => {
        if ((event.target as Element).closest("[data-ww-widget]")) return;
        const action = control.dataset.action;
        if (action === "taskmanager-refresh") {
          context.refreshTaskManager();
          return;
        }
        if (action === "taskmanager-add-course") {
          context.openTaskManagerCourseEditor();
          return;
        }
        if (action === "taskmanager-add-task") {
          context.openTaskManagerTaskEditor();
          return;
        }
        if (action === "taskmanager-run-command") {
          const command = document.querySelector<HTMLInputElement>(
            "#taskmanager-command",
          );
          if (command) context.taskManagerCommand(command.value);
          return;
        }
        if (action === "settings-toggle-widget") {
          if (control.dataset.widgetId)
            context.toggleWidgetFromSettings(control.dataset.widgetId);
          return;
        }
        if (action === "settings-reset") {
          context.resetSettings();
          return;
        }
        if (action === "settings-restore-dashboard") {
          context.restoreDefaultDashboard();
          return;
        }
        if (action === "waterlooworks-save-evaluator") {
          context.saveWaterlooWorksEvaluatorConfig();
          return;
        }
        if (action === "google-calendar-connect") {
          context.connectGoogleCalendar();
          return;
        }
        if (action === "google-calendar-sync") {
          context.refreshGoogleCalendar();
          return;
        }
        if (action === "google-calendar-disconnect") {
          context.disconnectGoogleCalendar();
          return;
        }
        if (action === "google-calendar-auto-sync") {
          context.updateSetting(
            "googleCalendarAutoSync",
            (control as HTMLInputElement).checked,
          );
          return;
        }
        if (action === "google-calendar-toggle") {
          const calendarId = control.dataset.calendarId;
          if (calendarId)
            context.setGoogleCalendarSelection(
              calendarId,
              (control as HTMLInputElement).checked,
            );
          return;
        }
        if (action === "add-calendar-event") {
          context.openEditor("event");
          return;
        }
        if (action === "edit-calendar-event") {
          const calendarEvent = context.state.events.find(
            (item) => item.id === Number(control.dataset.id),
          );
          if (calendarEvent?.source === "focusdesk")
            context.openEditor("event", calendarEvent.id);
          return;
        }
        if (action === "open-quick-link") {
          event.preventDefault();
          event.stopPropagation();
          const link = context.state.links.find(
            (item) => item.id === Number(control.dataset.linkId),
          );
          if (link) context.openNativeLink(link.url);
          return;
        }
        if (action === "taskmanager-open-status") {
          event.stopPropagation();
          const row = control.closest<HTMLElement>("[data-taskmanager-id]");
          const taskManagerId = row?.dataset.taskmanagerId;
          const taskManagerKey = row?.dataset.taskmanagerKey ?? taskManagerId;
          if (!taskManagerId) return;
          context.setTaskManagerStatusMenuId(
            context.getTaskManagerStatusMenuId() === taskManagerKey
              ? undefined
              : taskManagerKey,
          );
          context.render();
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
          context.setTaskManagerStatusMenuId(undefined);
          context.setTaskManagerStatus(taskManagerId, status.data);
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
            context.runTaskManagerMutation("tasks.delete", taskManagerId);
          } else {
            const completed = row.dataset.taskmanagerCompleted === "true";
            context.runTaskManagerMutation(
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
        const task = context.state.tasks.find((item) => item.id === id);
        if (action === "toggle-task" && task) {
          void context
            .saveFocusDeskTask({ ...task, done: !task.done })
            .then(() => context.render());
        }
        if (action === "delete-task" && task) {
          void context.deleteFocusDeskTask(id).then(() => context.render());
        }
        if (action === "edit-task" && task) context.openEditor("task", id);
        if (action === "edit-link") {
          event.preventDefault();
          event.stopPropagation();
          const linkId = Number(control.dataset.id);
          if (context.state.links.some((item) => item.id === linkId))
            context.openEditor("link", linkId);
          return;
        }
        if (action === "delete-note") {
          context.state.notes = context.state.notes.filter(
            (item) => item.id !== Number(control.dataset.id),
          );
          context.persist();
        }
        if (action === "delete-link") {
          event.preventDefault();
          event.stopPropagation();
          context.state.links = context.state.links.filter(
            (item) => item.id !== Number(control.dataset.id),
          );
          context.persist();
        }
        if (action === "add-task") context.openEditor("task");
        if (action === "add-note") context.openEditor("note");
        if (action === "add-link") context.openEditor("link");
        if (action === "open-search") context.openSearch();
        if (action === "start-focus") context.openFocus(id);
        if (action === "toggle-widgets") context.toggleWidgets();
        if (action === "toggle-preview") context.togglePreview();
        if (action === "add-widget") context.addWidget();
        if (action === "set-widget-dimension" && control.dataset.widgetId)
          context.setWidgetDimension(
            control.dataset.widgetId,
            (control as HTMLSelectElement).value,
          );
        if (action === "hide-widget" && control.dataset.widgetId)
          context.hideWidget(control.dataset.widgetId);
        if (
          action === "open-widget" &&
          control.dataset.widgetId &&
          !context.getWidgetEditMode()
        )
          context.openWidget(control.dataset.widgetId);
        if (action === "import-ics") context.importCalendar();
        if (action === "select-date" && control.dataset.date)
          context.selectDate(control.dataset.date);
        if (action === "prev-month") context.previousMonth();
        if (action === "next-month") context.nextMonth();
        if (action === "calendar-today") context.calendarToday();
      }),
  );
}
