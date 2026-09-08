import type { FocusDeskSettings } from "../settings";

export type AppView =
  | "today"
  | "tasks"
  | "taskmanager"
  | "waterlooworks"
  | "calendar"
  | "notes"
  | "links"
  | "settings";
export type TaskManagerMode = FocusDeskSettings["taskManagerMode"];
export type TaskManagerProgressView =
  FocusDeskSettings["taskManagerProgressView"];
