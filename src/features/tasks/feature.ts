import type { FeatureDefinition } from "../../contracts/features";
import { taskManagerWidgets } from "./widgets/definitions";

export const taskManagerFeature: FeatureDefinition = {
  manifest: { id: "tasks", title: "TaskManager", icon: "✓" },
  widgets: taskManagerWidgets,
};
