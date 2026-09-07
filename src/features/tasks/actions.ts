import { z } from "zod";

import type { ActionDefinition } from "../../actions/action-registry";
import type { TaskManagerClient } from "./tasks-client";
import { TaskManagerStatusSchema } from "./model";

const EmptyInput = z.object({});
const TaskIdInput = z.object({
  id: z.string().min(1),
  occurrenceDate: z.string().optional(),
});

export function createTaskManagerActions(
  client: TaskManagerClient,
): readonly ActionDefinition<unknown, unknown>[] {
  return [
    {
      manifest: { id: "tasks.refresh", title: "Refresh TaskManager tasks" },
      input: EmptyInput,
      handler: () => client.upcoming({ days: 30 }),
    },
    {
      manifest: {
        id: "tasks.create-course",
        title: "Create TaskManager course",
        mutatesData: true,
      },
      input: z.object({ name: z.string().min(1) }),
      handler: (input) =>
        client.createCourse(
          z.object({ name: z.string().min(1) }).parse(input).name,
        ),
    },
    {
      manifest: {
        id: "tasks.update-course",
        title: "Rename TaskManager course",
        mutatesData: true,
      },
      input: z.object({ id: z.string().min(1), name: z.string().min(1) }),
      handler: (input) => {
        const parsed = z
          .object({ id: z.string().min(1), name: z.string().min(1) })
          .parse(input);
        return client.updateCourse(parsed.id, parsed.name);
      },
    },
    {
      manifest: {
        id: "tasks.delete-course",
        title: "Delete TaskManager course",
        mutatesData: true,
        requiresConfirmation: true,
      },
      input: z.object({ id: z.string().min(1), confirm: z.literal(true) }),
      handler: (input) => {
        const parsed = z
          .object({ id: z.string().min(1), confirm: z.literal(true) })
          .parse(input);
        return client.deleteCourse(parsed.id, parsed.confirm);
      },
    },
    {
      manifest: {
        id: "tasks.create-task",
        title: "Create TaskManager task",
        mutatesData: true,
      },
      input: z.object({
        courseId: z.string().min(1),
        title: z.string().min(1),
        weight: z.number().nonnegative().optional(),
        deadline: z.string().nullable().optional(),
        isExam: z.boolean().optional(),
        priority: z.enum(["low", "normal", "high"]).optional(),
        status: TaskManagerStatusSchema.optional(),
      }),
      handler: (input) =>
        client.createTask(
          input as Parameters<TaskManagerClient["createTask"]>[0],
        ),
    },
    {
      manifest: {
        id: "tasks.update-task",
        title: "Update TaskManager task",
        mutatesData: true,
      },
      input: z.object({
        id: z.string().min(1),
        title: z.string().min(1).optional(),
        weight: z.number().nonnegative().optional(),
        deadline: z.string().nullable().optional(),
        isExam: z.boolean().optional(),
        priority: z.enum(["low", "normal", "high"]).optional(),
        status: TaskManagerStatusSchema.optional(),
      }),
      handler: (input) => {
        const parsed = z
          .object({
            id: z.string().min(1),
            title: z.string().min(1).optional(),
            weight: z.number().nonnegative().optional(),
            deadline: z.string().nullable().optional(),
            isExam: z.boolean().optional(),
            priority: z.enum(["low", "normal", "high"]).optional(),
            status: TaskManagerStatusSchema.optional(),
          })
          .parse(input);
        return client.updateTask(parsed.id, parsed);
      },
    },
    {
      manifest: {
        id: "tasks.complete",
        title: "Complete TaskManager task",
        mutatesData: true,
      },
      input: TaskIdInput,
      handler: (input) => {
        const { id, occurrenceDate } = TaskIdInput.parse(input);
        return client.completeTask(id, occurrenceDate);
      },
    },
    {
      manifest: {
        id: "tasks.reopen",
        title: "Reopen TaskManager task",
        mutatesData: true,
      },
      input: TaskIdInput,
      handler: (input) => {
        const { id, occurrenceDate } = TaskIdInput.parse(input);
        return client.reopenTask(id, occurrenceDate);
      },
    },
    {
      manifest: {
        id: "tasks.delete",
        title: "Delete TaskManager task",
        mutatesData: true,
        requiresConfirmation: true,
      },
      input: z.object({ id: z.string().min(1), confirm: z.literal(true) }),
      handler: (input) => {
        const { id, confirm } = z
          .object({ id: z.string().min(1), confirm: z.literal(true) })
          .parse(input);
        return client.deleteTask(id, confirm);
      },
    },
  ];
}
