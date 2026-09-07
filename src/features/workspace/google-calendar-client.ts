import { z } from "zod";

import { CalendarEventSchema, type CalendarEvent } from "./model";
import { invokeNative, type NativeInvoke } from "../../platform/native-bridge";
import {
  googleWriteOperation,
  type GoogleCalendarSyncResult,
  type GoogleCalendarEventSnapshot,
  type GoogleCalendarDeletedEvent,
} from "./calendar-sync";

const GoogleBooleanSchema = z.preprocess(
  (value) => (typeof value === "number" ? value !== 0 : value),
  z.boolean(),
);

const GoogleCalendarEventSnapshotSchema = z.object({
  id: z.string(),
  iCalUID: z.string().optional(),
  calendarId: z.string(),
  title: z.string(),
  date: z.string(),
  time: z.string().optional(),
  focusDeskEventId: z.number().optional(),
  etag: z.string().optional(),
  updatedAt: z.string().optional(),
});

const GoogleCalendarDeletedEventSchema = z.object({
  id: z.string(),
  calendarId: z.string(),
  iCalUID: z.string().optional(),
  focusDeskEventId: z.number().optional(),
});

const GoogleCalendarSyncResultSchema = z.object({
  connected: GoogleBooleanSchema,
  calendarId: z.string(),
  events: z.array(GoogleCalendarEventSnapshotSchema),
  deleted: z.array(GoogleCalendarDeletedEventSchema),
  syncedAt: z.string().optional(),
});

const GoogleCalendarStatusSchema = z.object({
  connected: GoogleBooleanSchema,
  calendarId: z.string(),
  lastSyncAt: z.string().optional(),
});

const GoogleCalendarSummarySchema = z.object({
  id: z.string(),
  summary: z.string(),
  description: z.string().optional(),
  primary: GoogleBooleanSchema.optional(),
  selected: GoogleBooleanSchema.optional(),
  backgroundColor: z.string().optional(),
  accessRole: z.string().optional(),
});

const GoogleCalendarListSchema = z.object({
  calendars: z.array(GoogleCalendarSummarySchema),
});

const GoogleCalendarEventResponseSchema = z.object({
  event: CalendarEventSchema,
});

export interface GoogleCalendarConfiguration {
  clientId: string;
  scopes: readonly string[];
  calendarId?: string;
  calendarIds?: readonly string[];
  fullSync?: boolean;
}

export type GoogleCalendarSummary = z.infer<typeof GoogleCalendarSummarySchema>;

export interface GoogleCalendarClient {
  status(configuration: GoogleCalendarConfiguration): Promise<{
    connected: boolean;
    calendarId: string;
    lastSyncAt?: string;
  }>;
  authorize(configuration: GoogleCalendarConfiguration): Promise<{
    connected: boolean;
    calendarId: string;
  }>;
  calendars(
    configuration: GoogleCalendarConfiguration,
  ): Promise<{ calendars: GoogleCalendarSummary[] }>;
  sync(
    configuration: GoogleCalendarConfiguration,
  ): Promise<GoogleCalendarSyncResult>;
  create(
    configuration: GoogleCalendarConfiguration,
    event: CalendarEvent,
  ): Promise<CalendarEvent>;
  update(
    configuration: GoogleCalendarConfiguration,
    event: CalendarEvent,
  ): Promise<CalendarEvent>;
  delete(
    configuration: GoogleCalendarConfiguration,
    event: CalendarEvent,
  ): Promise<void>;
  disconnect(): Promise<void>;
}

function assertWriteOperation(
  event: CalendarEvent,
  expected: "insert" | "update",
): void {
  const operation = googleWriteOperation(event);
  if (operation.kind !== expected) {
    throw new Error(
      `Google Calendar ${expected} suppressed for an inbound or unowned event.`,
    );
  }
}

export function createGoogleCalendarClient(
  invoke: NativeInvoke = invokeNative,
): GoogleCalendarClient {
  const call = <TResult>(action: string, payload: unknown = {}) =>
    invoke<TResult>(action, payload);

  function configPayload(configuration: GoogleCalendarConfiguration) {
    return {
      clientId: configuration.clientId,
      scopes: configuration.scopes,
      ...(configuration.calendarId
        ? { calendarId: configuration.calendarId }
        : {}),
      ...(configuration.calendarIds
        ? { calendarIds: configuration.calendarIds }
        : {}),
      ...(configuration.fullSync ? { fullSync: true } : {}),
    };
  }

  return {
    async status(configuration) {
      return GoogleCalendarStatusSchema.parse(
        await call("googleCalendar.status", configPayload(configuration)),
      );
    },
    async authorize(configuration) {
      return GoogleCalendarStatusSchema.parse(
        await call("googleCalendar.authorize", configPayload(configuration)),
      );
    },
    async calendars(configuration) {
      return GoogleCalendarListSchema.parse(
        await call("googleCalendar.calendars", configPayload(configuration)),
      );
    },
    async sync(configuration) {
      return GoogleCalendarSyncResultSchema.parse(
        await call("googleCalendar.sync", configPayload(configuration)),
      ) as GoogleCalendarSyncResult;
    },
    async create(configuration, event) {
      assertWriteOperation(event, "insert");
      const response = GoogleCalendarEventResponseSchema.parse(
        await call("googleCalendar.create", {
          ...configPayload({
            ...configuration,
            calendarId: event.googleCalendarId ?? configuration.calendarId,
          }),
          event,
        }),
      );
      return response.event;
    },
    async update(configuration, event) {
      assertWriteOperation(event, "update");
      const response = GoogleCalendarEventResponseSchema.parse(
        await call("googleCalendar.update", {
          ...configPayload({
            ...configuration,
            calendarId: event.googleCalendarId ?? configuration.calendarId,
          }),
          event,
        }),
      );
      return response.event;
    },
    async delete(configuration, event) {
      assertWriteOperation(event, "update");
      await call("googleCalendar.delete", {
        ...configPayload(configuration),
        event,
      });
    },
    async disconnect() {
      await call("googleCalendar.disconnect");
    },
  };
}

export type { GoogleCalendarDeletedEvent, GoogleCalendarEventSnapshot };
