import type { WidgetDimension, WidgetView } from "../../../contracts/widgets";
import { defineWidget } from "../../../widgets/define-widget";
import { visualHeight } from "../../../widgets/widget-dimensions";
import { renderTaskManager } from "./renderers";

function dimensionedViews(
  render: (
    context: Parameters<WidgetView["render"]>[0],
    dimension: WidgetDimension,
  ) => string,
) {
  const dimensions = ["2x2", "2x3", "4x3"] as const;
  const views: Partial<Record<WidgetDimension, WidgetView>> = {};
  for (const dimension of dimensions) {
    views[dimension] = {
      render: (context) => render(context, dimension),
      minimumHeight: visualHeight(dimension),
    };
  }
  return views;
}

export const taskManagerWidgets = [
  defineWidget({
    id: "tasks.task-manager",
    featureId: "tasks",
    title: "TaskManager",
    description: "Courses and tasks stored by FocusDesk",
    icon: "✓",
    defaultDimension: "2x2",
    capabilities: ["read-data", "mutate-data"],
    views: dimensionedViews(renderTaskManager),
  }),
] as const;
