import { z } from "zod";

import { TaskSchema, type Task } from "./model";
import { invokeNative, type NativeInvoke } from "../../platform/native-bridge";

const TaskListResponseSchema = z.object({
  tasks: z.array(z.unknown()),
});

const TaskResponseSchema = z.object({
  task: z.unknown(),
});

const DeleteTaskResponseSchema = z.object({
  deletedId: z.number(),
});

export interface FocusDeskTasksClient {
  bootstrap(tasks: readonly Task[]): Promise<readonly Task[]>;
  list(): Promise<readonly Task[]>;
  save(task: Task): Promise<Task>;
  delete(id: number): Promise<number>;
}

export function createFocusDeskTasksClient(
  invoke: NativeInvoke = invokeNative,
): FocusDeskTasksClient {
  const taskMetadata = new Map<number, Task>();
  const call = <TResult>(action: string, payload: unknown = {}) =>
    invoke<TResult>(action, payload);

  function mergeNativeTask(raw: unknown, fallback?: Task): Task {
    const parsed = TaskSchema.parse(raw) as Task;
    const source =
      typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>)
        : {};
    const hasRecurrence = Object.prototype.hasOwnProperty.call(
      source,
      "recurrence",
    );
    const hasCompletedDates =
      Object.prototype.hasOwnProperty.call(source, "completedDates") ||
      Object.prototype.hasOwnProperty.call(source, "completedOccurrences");
    const hasFallbackRecurrence =
      fallback !== undefined &&
      Object.prototype.hasOwnProperty.call(fallback, "recurrence");
    const hasFallbackCompletedDates =
      fallback !== undefined &&
      Object.prototype.hasOwnProperty.call(fallback, "completedDates");
    const merged: Task = { ...parsed };
    if (hasRecurrence || hasFallbackRecurrence)
      merged.recurrence = hasRecurrence
        ? parsed.recurrence
        : (fallback?.recurrence ?? null);
    else delete merged.recurrence;
    if (hasCompletedDates || hasFallbackCompletedDates)
      merged.completedDates = hasCompletedDates
        ? (parsed.completedDates ?? [])
        : (fallback?.completedDates ?? []);
    else delete merged.completedDates;
    taskMetadata.set(merged.id, merged);
    return merged;
  }

  function parseTaskList(
    raw: unknown,
    fallbacks: readonly Task[] = [],
  ): Task[] {
    const response = TaskListResponseSchema.parse(raw);
    return response.tasks.map((candidate) => {
      const id =
        typeof candidate === "object" &&
        candidate !== null &&
        typeof (candidate as Record<string, unknown>).id === "number"
          ? ((candidate as Record<string, unknown>).id as number)
          : undefined;
      const fallback =
        fallbacks.find((task) => task.id === id) ??
        (id === undefined ? undefined : taskMetadata.get(id));
      return mergeNativeTask(candidate, fallback);
    });
  }

  return {
    async bootstrap(tasks) {
      const normalizedTasks = tasks.map(
        (task) => TaskSchema.parse(task) as Task,
      );
      return parseTaskList(
        await call("focusdesk.tasks.bootstrap", { tasks: normalizedTasks }),
        tasks,
      );
    },
    async list() {
      return parseTaskList(await call("focusdesk.tasks.list"));
    },
    async save(task) {
      const normalizedTask = TaskSchema.parse(task) as Task;
      const response = TaskResponseSchema.parse(
        await call("focusdesk.tasks.save", normalizedTask),
      );
      return mergeNativeTask(response.task, task);
    },
    async delete(id) {
      taskMetadata.delete(id);
      const response = DeleteTaskResponseSchema.parse(
        await call("focusdesk.tasks.delete", { id }),
      );
      return response.deletedId;
    },
  };
}
