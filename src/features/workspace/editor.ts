import type { AppState } from "../../app/app-state";
import { element } from "../../ui/dom";
import { escapeHtml, localDate } from "../../ui/formatters";
import { DEFAULT_QUICK_LINK_COLOR } from "./quick-links";
import type { CalendarEvent, Priority, QuickLink, Task } from "./model";

export type EditorType = "task" | "note" | "link" | "event";

export interface EditorContext {
  state: AppState;
  now: Date;
  selectedDate: string;
  googleCalendarMessage: string;
  showModal: (content: string) => void;
  closeModal: () => void;
  render: () => void;
  persist: () => void;
  saveCalendarEvent: (event: CalendarEvent) => Promise<void>;
  deleteCalendarEvent: (event: CalendarEvent) => Promise<boolean>;
  saveFocusDeskTask: (task: Task) => Promise<boolean>;
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

  context.showModal(
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
      if (!(await context.saveFocusDeskTask(value))) {
        context.render();
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
      await context.saveCalendarEvent(value);
    }
    context.closeModal();
    if (type !== "task" && type !== "event") context.persist();
    else context.render();
  };
}
