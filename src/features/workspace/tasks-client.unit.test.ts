import { describe, expect, it } from "vitest";

import type { NativeInvoke } from "../../platform/native-bridge";
import { createFocusDeskTasksClient } from "./tasks-client";

const task = {
  id: 1,
  title: "Plan the day",
  done: false,
  tag: "Inbox",
  date: "2026-09-06",
  priority: "normal" as const,
};

describe("FocusDesk tasks client", () => {
  it("uses the native SQLite task actions", async () => {
    const calls: Array<{ action: string; payload: unknown }> = [];
    const invoke = (async (action: string, payload: unknown) => {
      calls.push({ action, payload });
      if (action.endsWith("bootstrap") || action.endsWith("list"))
        return { tasks: [task] };
      if (action.endsWith("save")) return { task };
      return { deletedId: 1 };
    }) as unknown as NativeInvoke;
    const client = createFocusDeskTasksClient(invoke);

    expect(await client.bootstrap([task])).toEqual([task]);
    expect(await client.list()).toEqual([task]);
    expect(await client.save(task)).toEqual(task);
    expect(await client.delete(1)).toBe(1);
    expect(calls.map((call) => call.action)).toEqual([
      "focusdesk.tasks.bootstrap",
      "focusdesk.tasks.list",
      "focusdesk.tasks.save",
      "focusdesk.tasks.delete",
    ]);
  });
});
