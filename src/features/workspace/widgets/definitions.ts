import type { WidgetDimension, WidgetView } from "../../../contracts/widgets";
import { defineWidget } from "../../../widgets/define-widget";
import { visualHeight } from "../../../widgets/widget-dimensions";
import {
  renderClock,
  renderFocus,
  renderLinks,
  renderNotes,
  renderSchedule,
  renderTasks,
  renderTracker,
} from "./renderers";

function dimensionedViews(
  render: (
    context: Parameters<WidgetView["render"]>[0],
    dimension: WidgetDimension,
  ) => string,
  dimensions: readonly WidgetDimension[],
) {
  const views: Partial<Record<WidgetDimension, WidgetView>> = {};
  for (const dimension of dimensions) {
    views[dimension] = {
      render: (context) => render(context, dimension),
      minimumHeight: visualHeight(dimension),
    };
  }
  return views;
}

const compact = [
  "1x2",
  "2x1",
  "2x2",
] as const satisfies readonly WidgetDimension[];
const standard = [
  "2x1",
  "2x2",
  "4x2",
] as const satisfies readonly WidgetDimension[];
const wide = [
  "2x1",
  "2x2",
  "4x2",
  "4x3",
] as const satisfies readonly WidgetDimension[];

export const workspaceWidgets = [
  defineWidget({
    id: "workspace.tracker",
    featureId: "workspace",
    title: "Daily tracker",
    description: "Tasks and progress",
    icon: "◔",
    defaultDimension: "2x1",
    views: dimensionedViews(renderTracker, ["2x1", "2x2", "4x2"]),
  }),
  defineWidget({
    id: "workspace.clock",
    featureId: "workspace",
    title: "Time",
    description: "Local time and date",
    icon: "◷",
    defaultDimension: "1x2",
    views: dimensionedViews(() => renderClock(), compact),
  }),
  defineWidget({
    id: "workspace.focus",
    featureId: "workspace",
    title: "Focus",
    description: "Start a focus session",
    icon: "◎",
    defaultDimension: "1x2",
    capabilities: ["read-data", "mutate-data"],
    views: dimensionedViews((context) => renderFocus(context), compact),
  }),
  defineWidget({
    id: "workspace.tasks",
    featureId: "workspace",
    title: "Tasks",
    description: "Your next actions",
    icon: "✓",
    defaultDimension: "2x2",
    capabilities: ["read-data", "mutate-data"],
    views: dimensionedViews(renderTasks, standard),
  }),
  defineWidget({
    id: "workspace.schedule",
    featureId: "workspace",
    title: "Schedule",
    description: "Calendar events",
    icon: "▦",
    defaultDimension: "2x1",
    views: dimensionedViews(renderSchedule, wide),
  }),
  defineWidget({
    id: "workspace.notes",
    featureId: "workspace",
    title: "Notes",
    description: "Recent scratch notes",
    icon: "✎",
    defaultDimension: "1x2",
    capabilities: ["read-data", "mutate-data"],
    views: dimensionedViews(renderNotes, compact),
  }),
  defineWidget({
    id: "workspace.links",
    featureId: "workspace",
    title: "Quick links",
    description: "Open anything quickly",
    icon: "↗",
    defaultDimension: "1x2",
    capabilities: ["read-data", "open-link"],
    views: dimensionedViews(renderLinks, ["1x2", "2x1", "4x2"]),
  }),
] as const;
