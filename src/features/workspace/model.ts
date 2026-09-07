import { z } from "zod";

export type Priority = "low" | "normal" | "high";

export interface Task {
  id: number;
  title: string;
  done: boolean;
  tag: string;
  date: string;
  time?: string;
  priority?: Priority;
}

export type CalendarEventSource = "focusdesk" | "google" | "ics";
export type CalendarEventSyncStatus = "pending" | "synced" | "error";

export interface CalendarEvent {
  id: number;
  title: string;
  date: string;
  time?: string;
  calendar?: string;
  source?: CalendarEventSource;
  googleCalendarId?: string;
  googleEventId?: string;
  googleICalUID?: string;
  googleETag?: string;
  googleUpdatedAt?: string;
  syncStatus?: CalendarEventSyncStatus;
  syncError?: string;
}

export interface Note {
  id: number;
  title: string;
  body: string;
  date: string;
}

export interface QuickLink {
  id: number;
  title: string;
  url: string;
  description?: string;
  asset?: string;
  color?: string;
}

export const TaskSchema = z.object({
  id: z.number(),
  title: z.string(),
  done: z.boolean(),
  tag: z.string(),
  date: z.string(),
  time: z.string().optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
});

export const CalendarEventSchema = z.object({
  id: z.number(),
  title: z.string(),
  date: z.string(),
  time: z.string().optional(),
  calendar: z.string().optional(),
  source: z.enum(["focusdesk", "google", "ics"]).optional(),
  googleCalendarId: z.string().optional(),
  googleEventId: z.string().optional(),
  googleICalUID: z.string().optional(),
  googleETag: z.string().optional(),
  googleUpdatedAt: z.string().optional(),
  syncStatus: z.enum(["pending", "synced", "error"]).optional(),
  syncError: z.string().optional(),
});

export const NoteSchema = z.object({
  id: z.number(),
  title: z.string(),
  body: z.string(),
  date: z.string(),
});

export const QuickLinkSchema = z.object({
  id: z.number(),
  title: z.string(),
  url: z.string(),
  description: z.string().optional(),
  asset: z.string().optional(),
  color: z.string().optional(),
});

export const WorkspaceWidgetDataSchema = z.object({
  tasks: z.array(TaskSchema),
  events: z.array(CalendarEventSchema),
  notes: z.array(NoteSchema),
  links: z.array(QuickLinkSchema),
  selectedDate: z.string(),
  focusDurationMinutes: z.number().int().min(5).max(120).optional(),
});
export type WorkspaceWidgetData = z.infer<typeof WorkspaceWidgetDataSchema>;
