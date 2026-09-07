import { describe, expect, it } from "vitest";

import { createTaskManagerClient } from "./tasks-client";
import type { NativeInvoke } from "../../platform/native-bridge";

const task = {
  id: "task-1",
  courseId: "course-1",
  courseName: "Focus 101",
  title: "Review notes",
  weight: 1,
  deadline: "2026-09-04T14:30:00-04:00",
  completed: false,
  isExam: false,
  priority: "high" as const,
  status: "none" as const,
  recurrence: null,
  completedOccurrences: [],
  createdAt: "2026-09-04T00:00:00+00:00",
  updatedAt: "2026-09-04T00:00:00+00:00",
};

describe("TaskManagerClient", () => {
  it("maps the versioned list response", async () => {
    const calls: string[] = [];
    const invoke: NativeInvoke = async <TResult>(action: string) => {
      calls.push(action);
      return {
        ok: true,
        apiVersion: "v1",
        data: { tasks: [task] },
      } as TResult;
    };
    const client = createTaskManagerClient(invoke);

    await expect(
      client.listTasks({ includeCompleted: false }),
    ).resolves.toEqual([task]);
    expect(calls).toEqual(["tasks.list"]);
  });

  it("rejects an invalid tool payload at the boundary", async () => {
    const invoke: NativeInvoke = async <TResult>() =>
      ({
        ok: true,
        apiVersion: "v1",
        data: { tasks: [{ id: "missing-required-fields" }] },
      }) as TResult;
    const client = createTaskManagerClient(invoke);
    await expect(client.listTasks()).rejects.toThrow();
  });

  it("accepts SQLite integer booleans from an older native build", async () => {
    const invoke: NativeInvoke = async <TResult>() =>
      ({
        ok: true,
        apiVersion: "v1",
        data: {
          tasks: [{ ...task, completed: 0, isExam: 1 }],
        },
      }) as TResult;
    const client = createTaskManagerClient(invoke);

    await expect(client.listTasks()).resolves.toMatchObject([
      { completed: false, isExam: true },
    ]);
  });

  it("updates a task status through the versioned boundary", async () => {
    let request: unknown;
    const invoke: NativeInvoke = async <TResult>(
      _action: string,
      payload?: unknown,
    ) => {
      request = payload;
      return {
        ok: true,
        apiVersion: "v1",
        data: { task: { ...task, status: "ready-to-submit" } },
      } as TResult;
    };
    const client = createTaskManagerClient(invoke);

    await expect(
      client.updateTask(task.id, { status: "ready-to-submit" }),
    ).resolves.toMatchObject({ status: "ready-to-submit" });
    expect(request).toEqual({ id: task.id, status: "ready-to-submit" });
  });
});
