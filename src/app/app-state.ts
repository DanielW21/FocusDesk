import type { WidgetLayoutDocument } from "../contracts/widgets";
import type {
  CalendarEvent,
  Note,
  QuickLink,
  Task,
} from "../features/workspace/model";
import type { FocusDeskSettings } from "../settings";

export type TaskFilter = "all" | "active" | "done";

export interface AppState {
  tasks: Task[];
  events: CalendarEvent[];
  notes: Note[];
  links: QuickLink[];
  widgetLayout: WidgetLayoutDocument;
  settings: FocusDeskSettings;
}
