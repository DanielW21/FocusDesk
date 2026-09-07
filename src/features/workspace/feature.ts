import type { FeatureDefinition } from "../../contracts/features";
import { workspaceWidgets } from "./widgets/definitions";

export const workspaceFeature: FeatureDefinition = {
  manifest: {
    id: "workspace",
    title: "Workspace",
    icon: "⌂",
  },
  widgets: workspaceWidgets,
};
