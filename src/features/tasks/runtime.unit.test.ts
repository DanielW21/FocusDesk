import { describe, expect, it } from "vitest";

import type { TaskManagerTask } from "./model";
import { taskManagerWidgetTasksFromRecords } from "./runtime";

function task(overrides: Partial<TaskManagerTask> = {}): TaskManagerTask {
  return {
    id: "weekly-lab",
    courseId: "course-1",
    courseName: "BME 384 - Biomedical Transport",
    title: "Tutorial",
    weight: 1,
    deadline: null,
    completed: false,
    isExam: false,
    priority: "normal",
    status: "none",
    recurrence: {
      type: "weekly",
      weekday: 0,
      start: "2026-09-01",
      end: "2026-09-30",
    },
    completedOccurrences: ["2026-09-07"],
    createdAt: "2026-09-01T00:00:00+00:00",
    updatedAt: "2026-09-01T00:00:00+00:00",
    ...overrides,
  };
}

describe("taskManagerWidgetTasksFromRecords", () => {
  it("expands active recurring occurrences and keeps their course code", () => {
    const tasks = taskManagerWidgetTasksFromRecords(
      [task()],
      new Date(2026, 8, 4),
    );

    expect(tasks.map((item) => item.date)).toEqual([
      "2026-09-14",
      "2026-09-21",
      "2026-09-28",
    ]);
    expect(tasks[0]).toMatchObject({
      courseCode: "BME 384",
      title: "Tutorial",
    });
  });

  it("does not duplicate one-off tasks while expanding recurrences", () => {
    const tasks = taskManagerWidgetTasksFromRecords(
      [
        task(),
        task({
          id: "one-off",
          title: "Student Survey",
          deadline: "2026-09-11T00:00:00-04:00",
          recurrence: null,
        }),
      ],
      new Date(2026, 8, 4),
    );

    expect(
      tasks.filter((item) => item.title === "Student Survey"),
    ).toHaveLength(1);
  });
});
