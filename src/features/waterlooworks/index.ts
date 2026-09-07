import "./waterlooworks.css";

export { waterlooWorksFeature } from "./feature";
export {
  createWaterlooWorksController,
  waterlooWorksController,
  type WaterlooWorksController,
  type WaterlooWorksControllerOptions,
} from "./controller";
export {
  createWaterlooWorksClient,
  type WaterlooWorksClient,
} from "./native-client";
export {
  PageConfigSchema,
  type PageConfig,
  type WaterlooWorksWidgetData,
  type BoardCoverage,
} from "./model";
export { waterlooWorksJobsWidget, renderWaterlooWorksWidget } from "./widgets";
