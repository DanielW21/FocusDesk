import type { TaskManagerTask } from "./model";

export interface WeeklySummaryItem {
  key: string;
  task: TaskManagerTask;
  dueDate: string;
  occurrenceDate?: string;
}

export interface WeeklySummaryGroup {
  weekStart: string;
  weekEnd: string;
  items: WeeklySummaryItem[];
}

export interface WeeklySummary {
  weeks: WeeklySummaryGroup[];
  unscheduled: TaskManagerTask[];
  archivedCount: number;
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDateKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, 12);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function sundayFor(date: Date): Date {
  const result = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    12,
  );
  result.setDate(result.getDate() - result.getDay());
  return result;
}

/**
 * Builds the rolling Open view without mutating TaskManager data. Weeks run
 * Sunday through Saturday. Past-due
 * one-off tasks are counted as archived, while recurring templates are
 * expanded into one independently completable occurrence per active week.
 */
export function createWeeklySummary(
  tasks: readonly TaskManagerTask[],
  today = new Date(),
  openEndedRecurrenceWeeks = 16,
): WeeklySummary {
  const currentWeek = sundayFor(today);
  const currentWeekKey = dateKey(currentWeek);
  const groups = new Map<string, WeeklySummaryItem[]>();
  const unscheduled: TaskManagerTask[] = [];
  let archivedCount = 0;

  const addItem = (item: WeeklySummaryItem): void => {
    const weekKey = dateKey(sundayFor(fromDateKey(item.dueDate)));
    const group = groups.get(weekKey) ?? [];
    group.push(item);
    groups.set(weekKey, group);
  };

  for (const task of tasks) {
    if (task.completed) continue;

    if (task.recurrence?.type === "weekly") {
      const weekday = task.recurrence.weekday;
      if (weekday === null || weekday === undefined) {
        unscheduled.push(task);
        continue;
      }

      const recurrenceStart = task.recurrence.start ?? currentWeekKey;
      const startKey =
        recurrenceStart > currentWeekKey ? recurrenceStart : currentWeekKey;
      const defaultEnd = dateKey(
        addDays(currentWeek, openEndedRecurrenceWeeks * 7 - 1),
      );
      const endKey = task.recurrence.end ?? defaultEnd;
      let occurrence = fromDateKey(startKey);
      const targetDay = (weekday + 1) % 7;
      const daysUntilOccurrence = (targetDay - occurrence.getDay() + 7) % 7;
      occurrence = addDays(occurrence, daysUntilOccurrence);

      while (dateKey(occurrence) <= endKey) {
        const occurrenceDate = dateKey(occurrence);
        if (!task.completedOccurrences.includes(occurrenceDate)) {
          addItem({
            key: `${task.id}:${occurrenceDate}`,
            task,
            dueDate: occurrenceDate,
            occurrenceDate,
          });
        }
        occurrence = addDays(occurrence, 7);
      }
      continue;
    }

    const dueDate = task.deadline?.slice(0, 10);
    if (!dueDate) {
      unscheduled.push(task);
    } else if (dueDate < currentWeekKey) {
      archivedCount += 1;
    } else {
      addItem({ key: task.id, task, dueDate });
    }
  }

  const weeks = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([weekStart, items]) => ({
      weekStart,
      weekEnd: dateKey(addDays(fromDateKey(weekStart), 6)),
      items: items.sort((left, right) => {
        const byDate = left.dueDate.localeCompare(right.dueDate);
        return byDate || left.task.title.localeCompare(right.task.title);
      }),
    }));

  return {
    weeks,
    unscheduled: unscheduled.sort((left, right) =>
      left.title.localeCompare(right.title),
    ),
    archivedCount,
  };
}
