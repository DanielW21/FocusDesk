import { z } from "zod";

import {
  TaskManagerTaskSchema,
  type TaskManagerStatus,
  type TaskManagerTask,
} from "./model";
import { invokeNative, type NativeInvoke } from "../../platform/native-bridge";

const TaskManagerEnvelopeSchema = z.object({
  ok: z.literal(true),
  apiVersion: z.literal("v1"),
  data: z.unknown(),
});

const TaskManagerHealthSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  apiVersion: z.literal("v1"),
  toolVersion: z.string(),
  schemaVersion: z.number().int(),
  supportedSchemaVersion: z.number().int(),
  revision: z.number().int().nonnegative(),
  dataFile: z.string(),
  courseCount: z.number().int().nonnegative(),
  taskCount: z.number().int().nonnegative(),
  issues: z.array(z.string()),
});

const CourseSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  taskCount: z.number().int().nonnegative(),
  completedTaskCount: z.number().int().nonnegative(),
  progressPercentage: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type TaskManagerHealth = z.infer<typeof TaskManagerHealthSchema>;
export type TaskManagerCourse = z.infer<typeof CourseSchema>;

export interface TaskManagerClient {
  health(): Promise<TaskManagerHealth>;
  createCourse(name: string): Promise<TaskManagerCourse>;
  updateCourse(id: string, name: string): Promise<TaskManagerCourse>;
  deleteCourse(id: string, confirm?: boolean): Promise<{ deletedId: string }>;
  listTasks(input?: {
    courseId?: string;
    includeCompleted?: boolean;
    isExam?: boolean;
  }): Promise<readonly TaskManagerTask[]>;
  getTask(id: string): Promise<TaskManagerTask>;
  upcoming(input?: {
    days?: number;
    now?: string;
  }): Promise<readonly TaskManagerTask[]>;
  createTask(input: {
    courseId: string;
    title: string;
    weight?: number;
    deadline?: string | null;
    completed?: boolean;
    isExam?: boolean;
    priority?: "low" | "normal" | "high";
    status?: TaskManagerStatus;
    recurrence?: {
      type: "weekly";
      weekday: number;
      start?: string | null;
      end?: string | null;
    } | null;
  }): Promise<TaskManagerTask>;
  updateTask(
    id: string,
    input: Partial<{
      courseId: string;
      title: string;
      weight: number;
      deadline: string | null;
      completed: boolean;
      isExam: boolean;
      priority: "low" | "normal" | "high";
      status: TaskManagerStatus;
      recurrence: {
        type: "weekly";
        weekday: number;
        start?: string | null;
        end?: string | null;
      } | null;
    }>,
  ): Promise<TaskManagerTask>;
  completeTask(id: string, occurrenceDate?: string): Promise<TaskManagerTask>;
  reopenTask(id: string, occurrenceDate?: string): Promise<TaskManagerTask>;
  deleteTask(id: string, confirm?: boolean): Promise<{ deletedId: string }>;
  listCourses(): Promise<readonly TaskManagerCourse[]>;
}

function parseData<TResult>(
  value: unknown,
  schema: z.ZodType<TResult>,
): TResult {
  const envelope = TaskManagerEnvelopeSchema.parse(value);
  return schema.parse(envelope.data);
}

function taskListSchema() {
  return z.object({
    tasks: z.array(TaskManagerTaskSchema),
  });
}

function taskResponseSchema() {
  return z.object({ task: TaskManagerTaskSchema });
}

/**
 * Client for FocusDesk's versioned native SQLite task-manager boundary. The
 * invoke function is injectable so this same client can be tested without
 * macOS/WebKit.
 */
export function createTaskManagerClient(
  invoke: NativeInvoke = invokeNative,
): TaskManagerClient {
  const call = <TResult>(action: string, payload: unknown = {}) =>
    invoke<TResult>(action, payload);

  return {
    async health() {
      return parseData(
        await call("taskmanager.health"),
        TaskManagerHealthSchema,
      );
    },
    async createCourse(name) {
      return parseData(
        await call("courses.create", { name }),
        z.object({ course: CourseSchema }),
      ).course;
    },
    async updateCourse(id, name) {
      return parseData(
        await call("courses.update", { id, name }),
        z.object({ course: CourseSchema }),
      ).course;
    },
    async deleteCourse(id, confirm = false) {
      return parseData(
        await call("courses.delete", { id, confirm }),
        z.object({ deletedId: z.string() }),
      );
    },
    async listTasks(input = {}) {
      return parseData(await call("tasks.list", input), taskListSchema()).tasks;
    },
    async getTask(id) {
      return parseData(await call("tasks.get", { id }), taskResponseSchema())
        .task;
    },
    async upcoming(input = {}) {
      return parseData(await call("tasks.upcoming", input), taskListSchema())
        .tasks;
    },
    async createTask(input) {
      return parseData(await call("tasks.create", input), taskResponseSchema())
        .task;
    },
    async updateTask(id, input) {
      return parseData(
        await call("tasks.update", { id, ...input }),
        taskResponseSchema(),
      ).task;
    },
    async completeTask(id, occurrenceDate) {
      return parseData(
        await call("tasks.complete", {
          id,
          ...(occurrenceDate ? { occurrenceDate } : {}),
        }),
        taskResponseSchema(),
      ).task;
    },
    async reopenTask(id, occurrenceDate) {
      return parseData(
        await call("tasks.reopen", {
          id,
          ...(occurrenceDate ? { occurrenceDate } : {}),
        }),
        taskResponseSchema(),
      ).task;
    },
    async deleteTask(id, confirm = false) {
      return parseData(
        await call("tasks.delete", { id, confirm }),
        z.object({ deletedId: z.string() }),
      );
    },
    async listCourses() {
      return parseData(
        await call("courses.list"),
        z.object({ courses: z.array(CourseSchema) }),
      ).courses;
    },
  };
}
