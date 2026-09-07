import { describe, expect, it } from "vitest";

import {
  createNativeWorkspaceClient,
  type NativeWorkspaceClient,
} from "./native-workspace-client";

const document = {
  schemaVersion: 1 as const,
  revision: 2,
  updatedAt: "2026-09-07T00:00:00.000Z",
  tables: { tasks: [], events: [], notes: [], links: [] },
  dashboard: { widgetLayout: {}, settings: {} },
};

describe("createNativeWorkspaceClient", () => {
  it("loads and saves the workspace document through the native bridge", async () => {
    const calls: Array<{ action: string; payload: unknown }> = [];
    const client: NativeWorkspaceClient = createNativeWorkspaceClient(
      async <TResult>(action: string, payload: unknown) => {
        calls.push({ action, payload });
        return (
          action === "focusdesk.workspace.load" ? { document } : {}
        ) as TResult;
      },
    );

    await expect(client.load()).resolves.toEqual(document);
    await expect(client.save(document)).resolves.toBeUndefined();
    expect(calls).toEqual([
      { action: "focusdesk.workspace.load", payload: undefined },
      { action: "focusdesk.workspace.save", payload: { document } },
    ]);
  });
});
