import type { CalendarEvent, CalendarEventSource } from "./model";

export const FOCUSDESK_GOOGLE_PROPERTY = "focusdeskEventId";

export interface GoogleCalendarEventSnapshot {
  id: string;
  iCalUID?: string;
  calendarId: string;
  title: string;
  date: string;
  time?: string;
  focusDeskEventId?: number;
  etag?: string;
  updatedAt?: string;
}

export interface GoogleCalendarDeletedEvent {
  id: string;
  calendarId: string;
  iCalUID?: string;
  focusDeskEventId?: number;
}

export interface GoogleCalendarSyncResult {
  connected: boolean;
  calendarId: string;
  events: GoogleCalendarEventSnapshot[];
  deleted: GoogleCalendarDeletedEvent[];
  syncedAt?: string;
}

export type GoogleWriteOperation =
  | { kind: "insert"; event: CalendarEvent }
  | { kind: "update"; event: CalendarEvent }
  | { kind: "none" };

/** Only FocusDesk-owned events are eligible for automatic Google writes. */
export function googleWriteOperation(
  event: CalendarEvent,
): GoogleWriteOperation {
  if (event.source !== "focusdesk") return { kind: "none" };
  return event.googleEventId
    ? { kind: "update", event }
    : { kind: "insert", event };
}

export function focusDeskGoogleProperties(
  event: CalendarEvent,
): Record<string, string> {
  return { [FOCUSDESK_GOOGLE_PROPERTY]: String(event.id) };
}

function matchesGoogleEvent(
  event: CalendarEvent,
  snapshot: GoogleCalendarEventSnapshot | GoogleCalendarDeletedEvent,
): boolean {
  if (
    event.googleCalendarId === snapshot.calendarId &&
    event.googleEventId === snapshot.id
  ) {
    return true;
  }
  if (
    snapshot.focusDeskEventId !== undefined &&
    event.id === snapshot.focusDeskEventId
  ) {
    return true;
  }
  return Boolean(
    snapshot.iCalUID &&
    event.googleCalendarId === snapshot.calendarId &&
    event.googleICalUID === snapshot.iCalUID,
  );
}

function sourceForPulledEvent(
  existing: CalendarEvent | undefined,
  snapshot: GoogleCalendarEventSnapshot,
): CalendarEventSource {
  return existing?.source === "focusdesk" ||
    snapshot.focusDeskEventId !== undefined
    ? "focusdesk"
    : "google";
}

export function upsertPulledGoogleEvent(
  events: CalendarEvent[],
  snapshot: GoogleCalendarEventSnapshot,
): CalendarEvent[] {
  const existingIndex = events.findIndex((event) =>
    matchesGoogleEvent(event, snapshot),
  );
  const existing = existingIndex >= 0 ? events[existingIndex] : undefined;
  const next: CalendarEvent = {
    id: existing?.id ?? snapshot.focusDeskEventId ?? Date.now() + Math.random(),
    title: snapshot.title,
    date: snapshot.date,
    time: snapshot.time,
    calendar: snapshot.calendarId,
    source: sourceForPulledEvent(existing, snapshot),
    googleCalendarId: snapshot.calendarId,
    googleEventId: snapshot.id,
    googleICalUID: snapshot.iCalUID,
    googleETag: snapshot.etag,
    googleUpdatedAt: snapshot.updatedAt,
    syncStatus: "synced",
  };

  if (existingIndex >= 0) {
    return events.map((event, index) =>
      index === existingIndex ? next : event,
    );
  }
  return [...events, next];
}

export function reconcileGoogleCalendarSync(
  events: CalendarEvent[],
  result: GoogleCalendarSyncResult,
  fullSync = false,
  fullSyncCalendarIds: readonly string[] = [],
): CalendarEvent[] {
  const syncedCalendarIds = new Set(
    fullSyncCalendarIds.length > 0
      ? fullSyncCalendarIds
      : result.events.map((snapshot) => snapshot.calendarId),
  );
  const deletedIds = result.deleted;
  let next = events.filter((event) => {
    if (deletedIds.some((deleted) => matchesGoogleEvent(event, deleted))) {
      return false;
    }
    if (
      fullSync &&
      event.source === "google" &&
      event.googleCalendarId &&
      syncedCalendarIds.has(event.googleCalendarId)
    ) {
      return result.events.some((snapshot) =>
        matchesGoogleEvent(event, snapshot),
      );
    }
    return true;
  });
  for (const snapshot of result.events) {
    next = upsertPulledGoogleEvent(next, snapshot);
  }
  return next;
}
