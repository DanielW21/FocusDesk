import { describe, expect, it } from "vitest";

import { createDefaultWidgetLayout } from "../features/workspace/default-layout";
import { createAppRegistries } from "../app/bootstrap";
import { WidgetLayoutStore } from "./widget-layout-store";

const timestamp = "2026-09-04T12:00:00.000Z";

describe("WidgetLayoutStore", () => {
  it("migrates the legacy focusdesk-v1 widget array", () => {
    const store = new WidgetLayoutStore(createAppRegistries().widgets);
    const layout = store.load(
      [
        { id: "tasks", type: "tasks", size: "large", visible: true },
        { id: "clock", type: "clock", size: "small", visible: false },
      ],
      createDefaultWidgetLayout(timestamp),
      timestamp,
    );

    expect(layout).toMatchObject({
      version: 3,
      revision: 0,
      instances: [
        {
          id: "tasks",
          widgetId: "workspace.tasks",
          dimension: "4x2",
          visible: true,
          order: 0,
        },
        {
          id: "clock",
          widgetId: "workspace.clock",
          dimension: "1x2",
          visible: false,
          order: 1,
        },
      ],
    });
  });

  it("migrates a version 2 dimension layout and preserves its revision", () => {
    const store = new WidgetLayoutStore(createAppRegistries().widgets);
    const layout = store.load(
      {
        version: 2,
        revision: 4,
        instances: [
          {
            id: "schedule",
            widgetId: "workspace.schedule",
            size: "medium",
            visible: true,
            order: 0,
            settings: {},
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
      },
      createDefaultWidgetLayout(timestamp),
      timestamp,
    );

    expect(layout).toMatchObject({
      version: 3,
      revision: 4,
      instances: [{ id: "schedule", dimension: "2x2", order: 0 }],
    });
  });

  it("falls back when persisted state is invalid", () => {
    const store = new WidgetLayoutStore(createAppRegistries().widgets);
    const fallback = createDefaultWidgetLayout(timestamp);

    expect(store.load({ version: 99 }, fallback, timestamp)).toEqual(fallback);
  });

  it("repairs invalid ordering and removes widgets that are no longer registered", () => {
    const store = new WidgetLayoutStore(createAppRegistries().widgets);
    const fallback = createDefaultWidgetLayout(timestamp);
    const layout = {
      ...fallback,
      instances: [
        { ...fallback.instances[1]!, order: 3 },
        {
          ...fallback.instances[0]!,
          id: "removed",
          widgetId: "removed.widget",
          order: 1,
        },
        { ...fallback.instances[0]!, order: 2 },
      ],
    };

    expect(
      store.repair(layout).instances.map(({ id, order }) => ({ id, order })),
    ).toEqual([
      { id: "tracker", order: 0 },
      { id: "clock", order: 1 },
    ]);
  });
});
