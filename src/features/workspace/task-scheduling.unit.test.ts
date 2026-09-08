import { describe, expect, it } from "vitest";

import {
  isOneTimeCarryOverTask,
  isRecurringTask,
  isTaskCompletedOnDate,
  isTaskScheduledOnDate,
  isTaskVisibleOnDate,
  setRecurringOccurrenceCompleted,
  type TaskSchedulingTask,
} from "./task-scheduling";

function oneTime(
  overrides: Partial<TaskSchedulingTask> = {},
): TaskSchedulingTask {
  return {
    date: "2026-09-08",
    recurrence: null,
    completedDates: [],
    done: false,
    ...overrides,
  };
}

function recurring(
  overrides: Partial<TaskSchedulingTask["recurrence"]> = {},
  taskOverrides: Partial<TaskSchedulingTask> = {},
): TaskSchedulingTask {
  return {
    date: "1999-01-01",
    recurrence: {
      type: "weekly",
      weekdays: [1, 3],
      start: "2026-09-07",
      end: "2026-09-30",
      ...overrides,
    },
    completedDates: [],
    ...taskOverrides,
  };
}

describe("task scheduling", () => {
  describe("one-time tasks", () => {
    it("is scheduled on its original date and carries over while open", () => {
      const task = oneTime();

      expect(isTaskScheduledOnDate(task, "2026-09-07")).toBe(false);
      expect(isTaskScheduledOnDate(task, "2026-09-08")).toBe(true);
      expect(isTaskScheduledOnDate(task, "2026-09-12")).toBe(true);
      expect(isTaskVisibleOnDate(task, "2026-09-12")).toBe(true);
      expect(isOneTimeCarryOverTask(task, "2026-09-08")).toBe(false);
      expect(isOneTimeCarryOverTask(task, "2026-09-12")).toBe(true);
    });

    it("does not show a completed one-time task or call it carry-over", () => {
      const task = oneTime({ done: true });

      expect(isTaskCompletedOnDate(task, "2026-09-08")).toBe(true);
      expect(isTaskCompletedOnDate(task, "2026-09-12")).toBe(true);
      expect(isTaskScheduledOnDate(task, "2026-09-12")).toBe(true);
      expect(isTaskVisibleOnDate(task, "2026-09-08")).toBe(false);
      expect(isTaskVisibleOnDate(task, "2026-09-12")).toBe(false);
      expect(isOneTimeCarryOverTask(task, "2026-09-12")).toBe(false);
    });
  });

  describe("daily recurrence", () => {
    it("includes both boundaries and supports an open-ended end", () => {
      const task = recurring({
        type: "daily",
        weekdays: [],
        start: "2026-09-08",
        end: null,
      });

      expect(isTaskScheduledOnDate(task, "2026-09-07")).toBe(false);
      expect(isTaskScheduledOnDate(task, "2026-09-08")).toBe(true);
      expect(isTaskScheduledOnDate(task, "2026-12-31")).toBe(true);
    });

    it("stops after an inclusive end date", () => {
      const task = recurring({
        type: "daily",
        start: "2026-09-08",
        end: "2026-09-10",
      });

      expect(isTaskScheduledOnDate(task, "2026-09-08")).toBe(true);
      expect(isTaskScheduledOnDate(task, "2026-09-10")).toBe(true);
      expect(isTaskScheduledOnDate(task, "2026-09-11")).toBe(false);
    });
  });

  describe("weekly recurrence", () => {
    it("matches multiple weekdays and excludes other days", () => {
      const task = recurring({ weekdays: [1, 3] });

      expect(isTaskScheduledOnDate(task, "2026-09-07")).toBe(true); // Monday
      expect(isTaskScheduledOnDate(task, "2026-09-09")).toBe(true); // Wednesday
      expect(isTaskScheduledOnDate(task, "2026-09-08")).toBe(false); // Tuesday
      expect(isTaskScheduledOnDate(task, "2026-09-30")).toBe(true); // end, Wednesday
      expect(isTaskScheduledOnDate(task, "2026-10-05")).toBe(false);
    });

    it("fails safely for empty, invalid, and reversed weekday rules", () => {
      expect(
        isTaskScheduledOnDate(recurring({ weekdays: [] }), "2026-09-07"),
      ).toBe(false);
      expect(
        isTaskScheduledOnDate(recurring({ weekdays: [7] }), "2026-09-07"),
      ).toBe(false);
      expect(
        isTaskScheduledOnDate(recurring({ start: "2026-02-30" }), "2026-09-07"),
      ).toBe(false);
      expect(
        isTaskScheduledOnDate(
          recurring({ start: "2026-09-10", end: "2026-09-08" }),
          "2026-09-10",
        ),
      ).toBe(false);
      expect(isTaskScheduledOnDate(recurring(), "not-a-date")).toBe(false);
    });
  });

  describe("recurring completion", () => {
    it("completes only the selected occurrence", () => {
      const task = recurring({}, { completedDates: ["2026-09-07"] });

      expect(isTaskCompletedOnDate(task, "2026-09-07")).toBe(true);
      expect(isTaskVisibleOnDate(task, "2026-09-07")).toBe(false);
      expect(isTaskCompletedOnDate(task, "2026-09-09")).toBe(false);
      expect(isTaskVisibleOnDate(task, "2026-09-09")).toBe(true);
    });

    it("marks, deduplicates, and unmarks without mutating the input", () => {
      const task = recurring({}, { completedDates: ["2026-09-07"] });
      const originalRecurrence = task.recurrence;
      const originalDates = task.completedDates;

      const marked = setRecurringOccurrenceCompleted(task, "2026-09-09", true);
      const markedAgain = setRecurringOccurrenceCompleted(
        marked,
        "2026-09-09",
        true,
      );
      const unmarked = setRecurringOccurrenceCompleted(
        markedAgain,
        "2026-09-07",
        false,
      );

      expect(marked.completedDates).toEqual(["2026-09-07", "2026-09-09"]);
      expect(markedAgain.completedDates).toEqual(["2026-09-07", "2026-09-09"]);
      expect(unmarked.completedDates).toEqual(["2026-09-09"]);
      expect(task.completedDates).toBe(originalDates);
      expect(task.completedDates).toEqual(["2026-09-07"]);
      expect(task.recurrence).toBe(originalRecurrence);
      expect(marked.recurrence).not.toBe(originalRecurrence);
      expect(marked.recurrence?.weekdays).not.toBe(
        originalRecurrence?.weekdays,
      );
    });

    it("returns a defensive copy for a one-time task", () => {
      const task = oneTime();
      const updated = setRecurringOccurrenceCompleted(task, "2026-09-08", true);

      expect(updated).not.toBe(task);
      expect(updated).toEqual(task);
      expect(updated.completedDates).not.toBe(task.completedDates);
    });
  });

  it("distinguishes recurring tasks from one-time tasks", () => {
    expect(isRecurringTask(oneTime())).toBe(false);
    expect(isRecurringTask(recurring())).toBe(true);
  });
});
