import type { AppState } from "../../app/app-state";
import { element } from "../../ui/dom";
import { escapeHtml, localDate } from "../../ui/formatters";
import { DEFAULT_QUICK_LINK_COLOR } from "./quick-links";
import type {
  CalendarEvent,
  Priority,
  QuickLink,
  Task,
  TaskRecurrence,
} from "./model";

export type EditorType = "task" | "note" | "link" | "event";

export interface EditorContext {
  state: AppState;
  now: Date;
  selectedDate: string;
  googleCalendarMessage: string;
  getFocusDeskTaskStorageMessage?: () => string;
  showModal: (content: string) => void;
  closeModal: () => void;
  render: () => void;
  persist: () => void;
  saveCalendarEvent: (event: CalendarEvent) => Promise<void>;
  deleteCalendarEvent: (event: CalendarEvent) => Promise<boolean>;
  saveFocusDeskTask: (task: Task) => Promise<boolean>;
}

const WEEKDAYS = [
  [0, "Sun"],
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
] as const;

function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error ?? new Error("Unable to read image"));
    reader.readAsDataURL(file);
  });
}

function taskSaveError(context: EditorContext): string {
  return (
    context.getFocusDeskTaskStorageMessage?.() ||
    "FocusDesk could not save this task. Your changes were not closed."
  );
}

function renderTaskForm(task: Task | undefined, selectedDate: string): string {
  const recurrence = task?.recurrence;
  const weekdays = recurrence?.weekdays ?? [];
  const recurrenceStart = recurrence?.start ?? task?.date ?? selectedDate;
  const recurrenceEnd = recurrence?.end ?? "";
  const taskKind = recurrence ? "recurring" : "one-time";
  const dateFields = task
    ? `<div class="form-row"><div class="form-group"><label>Date</label><input class="text-input" id="f-date" type="date" value="${escapeHtml(task.date)}"></div><div class="form-group"><label>Time</label><input class="text-input" id="f-time" type="time" value="${escapeHtml(task.time ?? "")}"></div></div>`
    : "";
  const categoryFields = task
    ? `<div class="form-row"><div class="form-group"><label>Category</label><input class="text-input" id="f-tag" value="${escapeHtml(task.tag ?? "")}" placeholder="Work, personal…"></div><div class="form-group"><label>Priority</label><select class="select-input" id="f-priority"><option value="normal" ${task.priority === "normal" || !task.priority ? "selected" : ""}>Normal</option><option value="high" ${task.priority === "high" ? "selected" : ""}>High</option><option value="low" ${task.priority === "low" ? "selected" : ""}>Low</option></select></div></div>`
    : '<p class="form-hint">One-time tasks stay in the task list until you complete them.</p>';
  const weekdayFields = WEEKDAYS.map(
    ([value, label]) =>
      `<label class="weekday-option"><input type="checkbox" data-recurrence-weekday="${value}" ${weekdays.includes(value) ? "checked" : ""}>${label}</label>`,
  ).join("");

  return `<div class="form-group"><label>Task</label><input class="text-input" id="f-title" value="${escapeHtml(task?.title ?? "")}" placeholder="What needs doing?" autocomplete="off"></div><div class="form-group"><label>Task type</label><select class="select-input" id="f-task-kind"><option value="one-time" ${taskKind === "one-time" ? "selected" : ""}>One-time checklist item</option><option value="recurring" ${taskKind === "recurring" ? "selected" : ""}>Recurring routine</option></select></div><div id="task-recurring-options" class="${recurrence ? "" : "hidden"}"><div class="form-row"><div class="form-group"><label>Repeat</label><select class="select-input" id="f-recurrence-type"><option value="daily" ${recurrence?.type === "daily" ? "selected" : ""}>Every day</option><option value="weekly" ${recurrence?.type === "weekly" ? "selected" : ""}>Selected weekdays</option></select></div><div class="form-group"><label>Start date</label><input class="text-input" id="f-recurrence-start" type="date" value="${escapeHtml(recurrenceStart)}"></div></div><div id="weekly-days" class="form-group ${recurrence?.type === "weekly" ? "" : "hidden"}"><label>Weekdays</label><div class="weekday-options">${weekdayFields}</div></div><div class="form-group"><label>End date <span class="label-note">optional</span></label><input class="text-input" id="f-recurrence-end" type="date" value="${escapeHtml(recurrenceEnd)}"></div><p class="form-hint">Recurring routines stay out of the calendar and are completed one occurrence at a time.</p></div><div id="task-one-time-options" class="${recurrence ? "hidden" : ""}">${dateFields}${categoryFields}</div><p class="form-error" id="task-form-error" role="alert"></p>`;
}

export function openQuickTask(context: EditorContext): void {
  context.showModal(
    '<div class="modal-kicker">QUICK ADD</div><h2>New task</h2><div class="form-group"><label>Task</label><input class="text-input" id="quick-task-modal" placeholder="What needs doing?" autocomplete="off"></div><p class="form-hint">One-time task · stays open until complete</p><p class="form-error" id="quick-task-error" role="alert"></p><div class="modal-footer"><button type="button" class="secondary-button" data-modal-close>Cancel</button><button type="button" class="primary-button" id="quick-task-save">Add task</button></div>',
  );
  const input = element<HTMLInputElement>("#quick-task-modal");
  const saveButton = element<HTMLButtonElement>("#quick-task-save");
  const error = element<HTMLElement>("#quick-task-error");
  const save = async (): Promise<void> => {
    const title = input.value.trim();
    if (!title) {
      error.textContent = "Enter a task first.";
      input.focus();
      return;
    }
    saveButton.disabled = true;
    const saved = await context.saveFocusDeskTask({
      id: Date.now(),
      title,
      done: false,
      tag: "Inbox",
      date: context.selectedDate,
      priority: "normal",
      recurrence: null,
      completedDates: [],
    });
    if (!saved) {
      saveButton.disabled = false;
      error.textContent = taskSaveError(context);
      return;
    }
    context.closeModal();
    context.render();
  };
  saveButton.onclick = () => void save();
  input.onkeydown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void save();
    }
  };
  input.focus();
}

export function openEditor(
  context: EditorContext,
  type: EditorType,
  editId?: number,
): void {
  const { state, now, selectedDate } = context;
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
    task: ["Task", renderTaskForm(task, selectedDate)],
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

  context.showModal(
    `<div class="modal-kicker">${editId ? "EDIT" : "NEW"}</div><h2>${forms[0]}</h2>${forms[1]}${type === "event" && event ? '<small class="form-hint calendar-delete-error" id="calendar-delete-error" role="alert"></small>' : ""}<div class="modal-footer">${type === "event" && event ? '<button type="button" class="danger-button" id="delete-calendar-event">Delete event</button>' : ""}<span class="modal-footer-spacer"></span><button type="button" class="secondary-button" data-modal-close>Cancel</button><button type="button" class="primary-button" id="save-modal">${editId ? "Save changes" : "Add task"}</button></div>`,
  );

  document.querySelector<HTMLInputElement>("#f-title")?.focus();

  if (type === "task") {
    const kind = element<HTMLSelectElement>("#f-task-kind");
    const recurringOptions = element<HTMLElement>("#task-recurring-options");
    const oneTimeOptions = element<HTMLElement>("#task-one-time-options");
    const repeatType = element<HTMLSelectElement>("#f-recurrence-type");
    const weeklyDays = element<HTMLElement>("#weekly-days");
    const updateTaskForm = (): void => {
      const recurring = kind.value === "recurring";
      recurringOptions.classList.toggle("hidden", !recurring);
      oneTimeOptions.classList.toggle("hidden", recurring);
      weeklyDays.classList.toggle(
        "hidden",
        !recurring || repeatType.value !== "weekly",
      );
    };
    kind.onchange = updateTaskForm;
    repeatType.onchange = updateTaskForm;
    updateTaskForm();
  }

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
      if (await context.deleteCalendarEvent(event)) {
        context.closeModal();
        context.render();
        return;
      }
      deleteButton.disabled = false;
      saveButton.disabled = false;
      deleteButton.dataset.confirm = "";
      deleteButton.textContent = "Delete event";
      deleteError.textContent =
        context.googleCalendarMessage ||
        "FocusDesk could not delete this event.";
    };
  }

  element<HTMLButtonElement>("#save-modal").onclick = async () => {
    const title = element<HTMLInputElement>("#f-title").value.trim();
    if (!title) {
      const error = document.querySelector<HTMLElement>("#task-form-error");
      if (error) error.textContent = "Enter a task first.";
      return;
    }
    if (type === "task") {
      const kind = element<HTMLSelectElement>("#f-task-kind").value;
      let recurrence: TaskRecurrence | null = null;
      let date = selectedDate;
      let time: string | undefined;
      let tag = "Inbox";
      let priority: Priority = "normal";
      if (kind === "recurring") {
        const recurrenceType = element<HTMLSelectElement>("#f-recurrence-type")
          .value as TaskRecurrence["type"];
        const start = element<HTMLInputElement>("#f-recurrence-start").value;
        const end = element<HTMLInputElement>("#f-recurrence-end").value;
        const weekdays = Array.from(
          document.querySelectorAll<HTMLInputElement>(
            "[data-recurrence-weekday]:checked",
          ),
        ).map((input) => Number(input.dataset.recurrenceWeekday));
        const error = element<HTMLElement>("#task-form-error");
        if (!start) {
          error.textContent = "Choose a start date for this routine.";
          return;
        }
        if (recurrenceType === "weekly" && weekdays.length === 0) {
          error.textContent = "Choose at least one weekday.";
          return;
        }
        if (end && end < start) {
          error.textContent =
            "The end date must be on or after the start date.";
          return;
        }
        recurrence = {
          type: recurrenceType,
          weekdays: recurrenceType === "daily" ? [] : weekdays,
          start,
          end: end || null,
        };
        date = start;
      } else if (task) {
        date = element<HTMLInputElement>("#f-date").value || selectedDate;
        time = element<HTMLInputElement>("#f-time").value || undefined;
        tag = element<HTMLInputElement>("#f-tag").value.trim() || "Inbox";
        priority = element<HTMLSelectElement>("#f-priority").value as Priority;
      }
      const value: Task = {
        id: task?.id ?? Date.now(),
        title,
        done: recurrence ? false : (task?.done ?? false),
        date,
        time,
        tag,
        priority,
        recurrence,
        completedDates: task?.completedDates ?? [],
      };
      const saveButton = element<HTMLButtonElement>("#save-modal");
      saveButton.disabled = true;
      const saved = await context.saveFocusDeskTask(value);
      if (!saved) {
        saveButton.disabled = false;
        element<HTMLElement>("#task-form-error").textContent =
          taskSaveError(context);
        return;
      }
      context.closeModal();
      context.render();
      return;
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
      await context.saveCalendarEvent(value);
    }
    context.closeModal();
    context.persist();
  };
}
