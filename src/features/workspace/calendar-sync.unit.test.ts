import { describe, expect, it } from "vitest";

import {
  FOCUSDESK_GOOGLE_PROPERTY,
  focusDeskGoogleProperties,
  googleWriteOperation,
  reconcileGoogleCalendarSync,
  upsertPulledGoogleEvent,
} from "./calendar-sync";
import type { CalendarEvent } from "./model";

const localEvent: CalendarEvent = {
  id: 42,
  title: "Design review",
  date: "2026-09-10",
  time: "10:00",
  source: "focusdesk",
};

describe("calendar sync", () => {
  it("only inserts or updates FocusDesk-owned events", () => {
    expect(googleWriteOperation(localEvent).kind).toBe("insert");
    expect(
      googleWriteOperation({ ...localEvent, googleEventId: "google-42" }).kind,
    ).toBe("update");
    expect(googleWriteOperation({ ...localEvent, source: "google" }).kind).toBe(
      "none",
    );
    expect(googleWriteOperation({ ...localEvent, source: "ics" }).kind).toBe(
      "none",
    );
  });

  it("adds a private correlation marker to outbound events", () => {
    expect(focusDeskGoogleProperties(localEvent)).toEqual({
      [FOCUSDESK_GOOGLE_PROPERTY]: "42",
    });
  });

  it("updates a local event found by its Google event ID", () => {
    const synced = upsertPulledGoogleEvent(
      [
        {
          ...localEvent,
          googleCalendarId: "primary",
          googleEventId: "google-42",
        },
      ],
      {
        id: "google-42",
        calendarId: "primary",
        title: "Design review moved",
        date: "2026-09-11",
        time: "11:00",
      },
    );

    expect(synced).toHaveLength(1);
    expect(synced[0]).toMatchObject({
      id: 42,
      title: "Design review moved",
      source: "focusdesk",
    });
  });

  it("updates an event by the private marker after an interrupted insert", () => {
    const synced = upsertPulledGoogleEvent([localEvent], {
      id: "google-42",
      calendarId: "primary",
      title: "Design review",
      date: "2026-09-10",
      focusDeskEventId: 42,
    });

    expect(synced).toHaveLength(1);
    expect(synced[0]).toMatchObject({
      id: 42,
      googleEventId: "google-42",
      source: "focusdesk",
    });
  });

  it("does not duplicate a normal Google event on repeated pulls", () => {
    const snapshot = {
      id: "google-external-1",
      calendarId: "primary",
      iCalUID: "external-1@example.com",
      title: "Dentist",
      date: "2026-09-12",
    };
    const once = upsertPulledGoogleEvent([], snapshot);
    const twice = upsertPulledGoogleEvent(once, snapshot);

    expect(once).toHaveLength(1);
    expect(twice).toHaveLength(1);
    expect(twice[0]?.source).toBe("google");
  });

  it("keeps recurring instances separate when they share an iCal UID", () => {
    const seriesUid = "class-series@example.com";
    const first = upsertPulledGoogleEvent([], {
      id: "series-instance-1",
      calendarId: "3b",
      iCalUID: seriesUid,
      title: "BME 362 LEC",
      date: "2026-10-19",
    });
    const second = upsertPulledGoogleEvent(first, {
      id: "series-instance-2",
      calendarId: "3b",
      iCalUID: seriesUid,
      title: "BME 362 LEC",
      date: "2026-10-26",
    });

    expect(second).toHaveLength(2);
    expect(second.map((event) => event.date)).toEqual([
      "2026-10-19",
      "2026-10-26",
    ]);
  });

  it("removes remote deletions without writing them back", () => {
    const next = reconcileGoogleCalendarSync(
      [
        {
          ...localEvent,
          googleCalendarId: "primary",
          googleEventId: "google-42",
        },
      ],
      {
        connected: true,
        calendarId: "primary",
        events: [],
        deleted: [{ id: "google-42", calendarId: "primary" }],
      },
    );

    expect(next).toEqual([]);
  });

  it("rebuilds selected Google calendars during a full sync", () => {
    const next = reconcileGoogleCalendarSync(
      [
        {
          id: 7,
          title: "Old recurring instance",
          date: "2026-09-08",
          source: "google",
          googleCalendarId: "3b",
          googleEventId: "old-instance",
        },
      ],
      {
        connected: true,
        calendarId: "3b",
        events: [
          {
            id: "new-instance",
            calendarId: "3b",
            title: "New recurring instance",
            date: "2026-09-09",
          },
        ],
        deleted: [],
      },
      true,
      ["3b"],
    );

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      title: "New recurring instance",
      date: "2026-09-09",
    });
  });

  it("removes cached events from calendars excluded from a full sync", () => {
    const next = reconcileGoogleCalendarSync(
      [
        {
          id: 7,
          title: "Portal copy",
          date: "2026-09-09",
          time: "11:00",
          source: "google",
          googleCalendarId: "portal",
          googleEventId: "portal-event",
        },
        {
          id: 8,
          title: "Selected event",
          date: "2026-09-09",
          time: "11:00",
          source: "google",
          googleCalendarId: "3b",
          googleEventId: "selected-event",
        },
      ],
      {
        connected: true,
        calendarId: "3b",
        events: [
          {
            id: "selected-event",
            calendarId: "3b",
            title: "Selected event updated",
            date: "2026-09-09",
            time: "11:00",
          },
        ],
        deleted: [],
      },
      true,
      ["3b"],
    );

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      googleCalendarId: "3b",
      title: "Selected event updated",
    });
  });
});
