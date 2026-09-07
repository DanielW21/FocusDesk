import { describe, expect, it } from "vitest";

import type { TaskManagerTask } from "./model";
import { createWeeklySummary } from "./weekly-summary";

function task(overrides: Partial<TaskManagerTask> = {}): TaskManagerTask {
  return {
    id: "task-1",
    courseId: "course-1",
    courseName: "Focus 101",
    title: "Review notes",
    weight: 1,
    deadline: "2026-09-11T14:30:00-04:00",
    completed: false,
    isExam: false,
    priority: "normal",
    status: "none",
    recurrence: null,
    completedOccurrences: [],
    createdAt: "2026-09-01T00:00:00+00:00",
    updatedAt: "2026-09-01T00:00:00+00:00",
    ...overrides,
  };
}

describe("createWeeklySummary", () => {
  it("groups upcoming work by Sunday-based weeks", () => {
    const summary = createWeeklySummary(
      [
        task(),
        task({
          id: "task-2",
          title: "Submit lab",
          deadline: "2026-09-08T09:00:00-04:00",
        }),
        task({
          id: "task-3",
          title: "Write proposal",
          deadline: "2026-09-22T09:00:00-04:00",
        }),
      ],
      new Date(2026, 8, 4),
    );

    expect(summary.weeks.map((week) => week.weekStart)).toEqual([
      "2026-09-06",
      "2026-09-20",
    ]);
    expect(summary.weeks[0]?.items.map((item) => item.task.title)).toEqual([
      "Submit lab",
      "Review notes",
    ]);
  });

  it("archives expired weeks and promotes the next active week", () => {
    const summary = createWeeklySummary(
      [
        task({ id: "old", deadline: "2026-09-04T09:00:00-04:00" }),
        task({ id: "next", deadline: "2026-09-15T09:00:00-04:00" }),
      ],
      new Date(2026, 8, 14),
    );

    expect(summary.archivedCount).toBe(1);
    expect(summary.weeks[0]?.weekStart).toBe("2026-09-13");
    expect(summary.weeks[0]?.items[0]?.task.id).toBe("next");
  });

  it("adds weekly recurrences once per week and omits completed occurrences", () => {
    const summary = createWeeklySummary(
      [
        task({
          deadline: null,
          recurrence: {
            type: "weekly",
            weekday: 0,
            start: "2026-09-01",
            end: "2026-09-30",
          },
          completedOccurrences: ["2026-09-07"],
        }),
      ],
      new Date(2026, 8, 4),
    );

    expect(
      summary.weeks
        .flatMap((week) => week.items)
        .map((item) => item.occurrenceDate),
    ).toEqual(["2026-09-14", "2026-09-21", "2026-09-28"]);
  });
});
