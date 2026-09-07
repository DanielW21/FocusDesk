import type { WidgetLayoutDocument } from "../contracts/widgets";

/** Add newly installed feature widgets once; preserve hidden widgets and layout choices. */
export function withWaterlooWorksWidget(
  layout: WidgetLayoutDocument,
  timestamp = new Date().toISOString(),
): WidgetLayoutDocument {
  if (layout.instances.some((item) => item.widgetId === "waterlooworks.jobs")) {
    return layout;
  }
  return {
    ...layout,
    revision: layout.revision + 1,
    instances: [
      ...layout.instances,
      {
        id: "waterlooworks-jobs",
        widgetId: "waterlooworks.jobs",
        dimension: "2x1",
        visible: true,
        order: layout.instances.length,
        settings: {},
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  };
}
