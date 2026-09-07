import type { FeatureDefinition } from "../../contracts/features";
import { waterlooWorksJobsWidget } from "./widgets";

export const waterlooWorksFeature: FeatureDefinition = {
  manifest: { id: "waterlooworks", title: "WaterlooWorks", icon: "↗" },
  widgets: [waterlooWorksJobsWidget],
};
