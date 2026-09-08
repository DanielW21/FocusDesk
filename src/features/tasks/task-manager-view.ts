import type { TaskManagerRuntimeSnapshot } from "./runtime";
import { createWeeklySummary, type WeeklySummaryItem } from "./weekly-summary";
import {
  TASK_MANAGER_STATUS_LABELS,
  type TaskManagerStatus,
  type TaskManagerTask,
} from "./model";
import type { FocusDeskSettings } from "../../settings";
import { escapeHtml } from "../../ui/formatters";

type TaskManagerMode = FocusDeskSettings["taskManagerMode"];
type TaskManagerProgressView = FocusDeskSettings["taskManagerProgressView"];

export interface TaskManagerViewContext {
  runtime: TaskManagerRuntimeSnapshot;
  mode: TaskManagerMode;
  progressView: TaskManagerProgressView;
  todoDays: number;
  statusMenuId: string | undefined;
  commandMessage: string;
}

function deadlineLabel(deadline: string | null): string {
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

function courseTaskDate(task: TaskManagerTask): string {
  if (!task.deadline) return task.recurrence ? "Weekly" : "No deadline";
  const parsed = new Date(task.deadline);
  if (Number.isNaN(parsed.getTime())) return "No deadline";
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
  }).format(parsed);
}

function statusControl(
  task: TaskManagerTask,
  context: TaskManagerViewContext,
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
    context.statusMenuId === menuKey
      ? `<div class="task-manager-status-menu" role="menu">${options
          .map(
            (option) =>
              `<button class="${option.value === status ? "selected" : ""}" data-action="taskmanager-set-status" data-status="${option.value}" role="menuitem">${escapeHtml(option.label)}</button>`,
          )
          .join("")}</div>`
      : "";
  return `<div class="task-manager-status-control"><button class="task-manager-status ${status}" data-action="taskmanager-open-status" aria-label="Set task status" title="Set status"><i></i><span>${escapeHtml(status === "none" ? "Tag" : label)}</span></button>${menu}</div>`;
}

function weeklyRange(start: string, end: string): string {
  const format = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("en-CA", {
      month: "short",
      day: "numeric",
    }).format(new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, 12));
  };
  return `${format(start)} – ${format(end)}`;
}

function weeklyRow(
  item: WeeklySummaryItem,
  context: TaskManagerViewContext,
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
    ${statusControl(task, context, item.key)}
    <button class="delete" data-action="taskmanager-delete" aria-label="Delete task">×</button>
  </div>`;
}

function weeklySummary(
  records: readonly TaskManagerTask[],
  context: TaskManagerViewContext,
): string {
  const summary = createWeeklySummary(records, new Date());
  const weeks = summary.weeks
    .map(
      (week, index) =>
        `<section class="task-manager-week ${index === 0 ? "current" : ""}">
        <header><div><span>${index === 0 ? "Up next" : "Week"}</span><h2>${escapeHtml(weeklyRange(week.weekStart, week.weekEnd))}</h2></div><b>${week.items.length} ${week.items.length === 1 ? "todo" : "todos"}</b></header>
        <div>${week.items.map((item) => weeklyRow(item, context)).join("")}</div>
      </section>`,
    )
    .join("");
  const unscheduled = summary.unscheduled.length
    ? `<section class="task-manager-week"><header><div><span>Anytime</span><h2>No date yet</h2></div><b>${summary.unscheduled.length} ${summary.unscheduled.length === 1 ? "todo" : "todos"}</b></header><div>${summary.unscheduled.map((task) => weeklyRow({ key: task.id, task, dueDate: new Date().toISOString().slice(0, 10) }, context, "Any day")).join("")}</div></section>`
    : "";
  if (!weeks && !unscheduled)
    return '<div class="empty"><span class="empty-icon">✓</span>Your weekly list is clear.</div>';
  return `<div class="task-manager-weeks">${weeks}${unscheduled}</div>`;
}

function courseProgress(
  records: readonly TaskManagerTask[],
  detailed: boolean,
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
        ? `<div class="task-manager-course-tasks">${course.tasks.map((task) => `<div class="task-manager-course-task ${task.completed ? "done" : ""}"><span>${escapeHtml(task.title)}</span><small>${escapeHtml(courseTaskDate(task))}</small></div>`).join("")}</div>`
        : "";
      return `<article class="task-manager-course ${detailed ? "detailed" : ""}"><div class="task-manager-course-heading"><div><strong>${escapeHtml(course.name)}</strong><span>${course.completed}/${course.total} tasks complete</span></div><b>${percent.toFixed(0)}%</b></div><div class="progress-track"><i style="width:${Math.min(100, Math.max(0, percent))}%"></i></div>${tasks}</article>`;
    })
    .join("")}</div>`;
}

export function renderTaskManagerView(context: TaskManagerViewContext): string {
  const { runtime } = context;
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
  const allRecords = [...runtime.records].sort((a, b) =>
    !a.deadline ? 1 : !b.deadline ? -1 : a.deadline.localeCompare(b.deadline),
  );
  const cutoff = Date.now() + context.todoDays * 24 * 60 * 60 * 1000;
  const records = allRecords.filter((task) => {
    if (context.mode === "list") return !task.completed;
    if (context.mode === "exams") return task.isExam && !task.completed;
    if (context.mode === "todo")
      return (
        !task.completed &&
        !!task.deadline &&
        new Date(task.deadline).getTime() <= cutoff
      );
    return true;
  });
  const openCount = allRecords.filter((task) => !task.completed).length;
  const title = {
    list: "Open tasks",
    fulllist: "All tasks",
    exams: "Upcoming exams",
    progress: "Progress",
    todo: `Due in ${context.todoDays} days`,
  }[context.mode];
  const content =
    context.mode === "progress"
      ? courseProgress(allRecords, context.progressView === "detailed")
      : context.mode === "list"
        ? weeklySummary(allRecords, context)
        : records.length
          ? records
              .map(
                (
                  task,
                ) => `<div class="task-manager-row ${task.completed ? "done" : ""}" data-taskmanager-id="${escapeHtml(task.id)}" data-taskmanager-completed="${task.completed}">
            <button class="check" data-action="taskmanager-toggle" aria-label="${task.completed ? "Reopen" : "Complete"} task">${task.completed ? "✓" : ""}</button>
            <div class="task-manager-copy"><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(task.courseName)} · ${escapeHtml(deadlineLabel(task.deadline))}</span></div>
            <span class="tag task-manager-priority">${task.isExam ? "Exam" : task.priority}</span>
            ${statusControl(task, context)}
            <button class="delete" data-action="taskmanager-delete" aria-label="Delete task">×</button>
          </div>`,
              )
              .join("")
          : '<div class="empty"><span class="empty-icon">✓</span>No tasks match this view.</div>';
  const progressControls =
    context.mode === "progress"
      ? `<div class="task-manager-progress-controls" aria-label="Progress layout"><span>Layout</span>${(["compact", "detailed"] as TaskManagerProgressView[]).map((layout) => `<button class="filter ${context.progressView === layout ? "active" : ""}" data-taskmanager-progress-view="${layout}">${layout === "compact" ? "Compact" : "Detailed"}</button>`).join("")}</div>`
      : "";
  return `<div class="view-wrap"><div class="title-row"><div><p class="eyebrow">Built into FocusDesk</p><h1>TaskManager</h1><p class="date-line">${title} · ${openCount} open · ${allRecords.length} total</p></div><div class="calendar-tools"><button class="primary-button" data-action="taskmanager-add-task">＋ Task</button><button class="secondary-button" data-action="taskmanager-add-course">＋ Course</button><button class="secondary-button" data-action="taskmanager-refresh">↻ Refresh</button></div></div><div class="task-manager-command-row"><input class="text-input" id="taskmanager-command" placeholder="Run a TaskManager command… (list, exams, progress, todo 7)"><button class="secondary-button" data-action="taskmanager-run-command">Run</button></div>${context.commandMessage ? `<p class="form-error">${escapeHtml(context.commandMessage)}</p>` : ""}<div class="task-manager-modes">${(["list", "fulllist", "exams", "progress", "todo"] as TaskManagerMode[]).map((mode) => `<button class="filter ${context.mode === mode ? "active" : ""}" data-taskmanager-mode="${mode}">${{ list: "Open", fulllist: "All", exams: "Exams", progress: "Progress", todo: "Todo" }[mode]}</button>`).join("")}</div>${progressControls}<div class="panel task-manager-panel">${content}</div></div>`;
}
