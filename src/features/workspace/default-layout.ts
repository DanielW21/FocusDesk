import type {
  WidgetDimension,
  WidgetLayoutDocument,
} from "../../contracts/widgets";

const defaults: ReadonlyArray<[string, WidgetDimension]> = [
  ["tracker", "2x2"],
  ["clock", "1x2"],
  ["focus", "1x2"],
  ["tasks", "2x2"],
  ["schedule", "4x2"],
  ["notes", "1x2"],
  ["links", "1x2"],
];

export function createDefaultWidgetLayout(
  now = new Date().toISOString(),
): WidgetLayoutDocument {
  return {
    version: 3,
    revision: 0,
    instances: defaults.map(([id, dimension], order) => ({
      id,
      widgetId: `workspace.${id}`,
      dimension,
      visible: true,
      order,
      settings: {},
      createdAt: now,
      updatedAt: now,
    })),
  };
}
