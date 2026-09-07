import { workspaceFeature } from "../features/workspace/feature";
import { taskManagerFeature } from "../features/tasks/feature";
import { createTaskManagerActions } from "../features/tasks/actions";
import { createTaskManagerClient } from "../features/tasks/tasks-client";
import { ActionRegistry } from "../actions/action-registry";
import { WidgetRegistry } from "../widgets/widget-registry";
import { FeatureRegistry } from "./feature-registry";

export interface AppRegistries {
  features: FeatureRegistry;
  widgets: WidgetRegistry;
  actions: ActionRegistry;
}

export function createAppRegistries(): AppRegistries {
  const widgets = new WidgetRegistry();
  const features = new FeatureRegistry(widgets);
  const actions = new ActionRegistry();
  features.register(workspaceFeature);
  features.register(taskManagerFeature);
  for (const action of createTaskManagerActions(createTaskManagerClient())) {
    actions.register(action);
  }
  return { features, widgets, actions };
}
