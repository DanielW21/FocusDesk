import type { AppRegistries } from "../../app/bootstrap";
import type { FocusDeskSettings } from "../../settings";
import type { TaskManagerRuntimeSnapshot } from "./runtime";
import { escapeHtml } from "../../ui/formatters";

type TaskManagerMode = FocusDeskSettings["taskManagerMode"];
type TaskManagerMutation = "tasks.complete" | "tasks.reopen" | "tasks.delete";

export interface TaskManagerActionsContext {
  runtime: TaskManagerRuntimeSnapshot;
  registries: AppRegistries;
  render: () => void;
  showModal: (content: string) => void;
  closeModal: () => void;
  focusElement: (selector: string) => HTMLElement;
  refreshRuntime: () => Promise<unknown>;
  getMode: () => TaskManagerMode;
  setMode: (mode: TaskManagerMode) => void;
  getTodoDays: () => number;
  setTodoDays: (days: number) => void;
  setCommandMessage: (message: string) => void;
}

export function createTaskManagerActions(context: TaskManagerActionsContext) {
  const mutationAction = (action: string, input: unknown): void => {
    void context.registries.actions
      .invoke(action, input, { source: "ui" })
      .then(() => context.refreshRuntime())
      .then(() => context.render())
      .catch((error: unknown) => {
        context.runtime.status = "error";
        context.runtime.message =
          error instanceof Error ? error.message : "TaskManager action failed.";
        context.render();
      });
  };

  const command = (value: string): void => {
    const [name, rawDays] = value.trim().toLowerCase().split(/\s+/);
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
      context.setCommandMessage(
        "Commands: list, fulllist, exams, progress, todo [days]",
      );
      context.render();
      return;
    }
    if (mode === "todo") {
      const days = rawDays === undefined ? 7 : Number(rawDays);
      if (!Number.isInteger(days) || days < 0) {
        context.setCommandMessage("Usage: todo [non-negative days]");
        context.render();
        return;
      }
      context.setTodoDays(days);
    }
    context.setCommandMessage("");
    context.setMode(mode);
    context.render();
  };

  const openCourseEditor = (): void => {
    context.showModal(
      `<div class="modal-kicker">TASKMANAGER</div><h2>New course</h2><div class="form-group"><label>Course name</label><input class="text-input" id="tm-course-name" placeholder="e.g. BME 362"></div><div class="modal-footer"><button class="secondary-button" data-modal-close>Cancel</button><button class="primary-button" id="tm-save-course">Add course</button></div>`,
    );
    context.focusElement("#tm-course-name").focus();
    context.focusElement("#tm-save-course").onclick = () => {
      const name = (
        context.focusElement("#tm-course-name") as HTMLInputElement
      ).value.trim();
      if (!name) return;
      context.closeModal();
      mutationAction("tasks.create-course", { name });
    };
  };

  const openTaskEditor = (): void => {
    if (!context.runtime.courses.length) {
      openCourseEditor();
      return;
    }
    const options = context.runtime.courses
      .map(
        (course) =>
          `<option value="${escapeHtml(course.id)}">${escapeHtml(course.name)}</option>`,
      )
      .join("");
    context.showModal(
      `<div class="modal-kicker">TASKMANAGER</div><h2>New task</h2><div class="form-group"><label>Course</label><select class="select-input" id="tm-course">${options}</select></div><div class="form-group"><label>Task title</label><input class="text-input" id="tm-title" placeholder="e.g. Lab report"></div><div class="form-row"><div class="form-group"><label>Deadline</label><input class="text-input" id="tm-deadline" type="datetime-local"></div><div class="form-group"><label>Weight</label><input class="text-input" id="tm-weight" type="number" min="0" step="0.25" value="0"></div></div><div class="form-row"><div class="form-group"><label>Priority</label><select class="select-input" id="tm-priority"><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select></div><div class="form-group"><label>Status</label><select class="select-input" id="tm-status"><option value="none">No status</option><option value="in-progress">In Progress</option><option value="ready-to-submit">Ready to Submit</option><option value="important">Important</option></select></div></div><label class="check-field"><input id="tm-exam" type="checkbox"> Exam</label><div class="modal-footer"><button class="secondary-button" data-modal-close>Cancel</button><button class="primary-button" id="tm-save-task">Add task</button></div>`,
    );
    context.focusElement("#tm-title").focus();
    context.focusElement("#tm-save-task").onclick = () => {
      const title = (
        context.focusElement("#tm-title") as HTMLInputElement
      ).value.trim();
      const weight = Number(
        (context.focusElement("#tm-weight") as HTMLInputElement).value || 0,
      );
      if (!title || !Number.isFinite(weight) || weight < 0) return;
      const rawDeadline = (
        context.focusElement("#tm-deadline") as HTMLInputElement
      ).value;
      mutationAction("tasks.create-task", {
        courseId: (context.focusElement("#tm-course") as HTMLSelectElement)
          .value,
        title,
        weight,
        deadline: rawDeadline ? new Date(rawDeadline).toISOString() : null,
        priority: (context.focusElement("#tm-priority") as HTMLSelectElement)
          .value,
        status: (context.focusElement("#tm-status") as HTMLSelectElement).value,
        isExam: (context.focusElement("#tm-exam") as HTMLInputElement).checked,
      });
      context.closeModal();
    };
  };

  const runMutation = (
    action: TaskManagerMutation,
    id: string,
    occurrenceDate?: string,
  ): void => {
    const input =
      action === "tasks.delete"
        ? { id, confirm: true as const }
        : { id, ...(occurrenceDate ? { occurrenceDate } : {}) };
    mutationAction(action, input);
  };

  return {
    command,
    refresh: () => void context.refreshRuntime().then(() => context.render()),
    mutationAction,
    openCourseEditor,
    openTaskEditor,
    runMutation,
  };
}
