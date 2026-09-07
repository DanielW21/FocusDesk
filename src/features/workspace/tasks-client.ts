import { z } from "zod";

import { TaskSchema, type Task } from "./model";
import { invokeNative, type NativeInvoke } from "../../platform/native-bridge";

const TaskListResponseSchema = z.object({
  tasks: z.array(TaskSchema),
});

const TaskResponseSchema = z.object({
  task: TaskSchema,
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
  const call = <TResult>(action: string, payload: unknown = {}) =>
    invoke<TResult>(action, payload);

  return {
    async bootstrap(tasks) {
      const response = TaskListResponseSchema.parse(
        await call("focusdesk.tasks.bootstrap", { tasks }),
      );
      return response.tasks;
    },
    async list() {
      const response = TaskListResponseSchema.parse(
        await call("focusdesk.tasks.list"),
      );
      return response.tasks;
    },
    async save(task) {
      const response = TaskResponseSchema.parse(
        await call("focusdesk.tasks.save", task),
      );
      return response.task;
    },
    async delete(id) {
      const response = DeleteTaskResponseSchema.parse(
        await call("focusdesk.tasks.delete", { id }),
      );
      return response.deletedId;
    },
  };
}
