import { describe, expect, it, vi } from "vitest";

import { createGoogleCalendarClient } from "./google-calendar-client";
import type { CalendarEvent } from "./model";

const configuration = {
  clientId: "client.apps.googleusercontent.com",
  scopes: ["https://www.googleapis.com/auth/calendar.events"],
} as const;

const inboundEvent: CalendarEvent = {
  id: 1,
  title: "External event",
  date: "2026-09-10",
  source: "google",
  googleCalendarId: "primary",
  googleEventId: "google-1",
};

describe("GoogleCalendarClient write protection", () => {
  it("does not write inbound Google events", async () => {
    const invoke = vi.fn();
    const client = createGoogleCalendarClient(invoke);

    await expect(client.update(configuration, inboundEvent)).rejects.toThrow(
      "suppressed",
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("allows an insert only for a FocusDesk-owned event", async () => {
    const invoke = vi.fn().mockResolvedValue({
      event: {
        id: 2,
        title: "FocusDesk event",
        date: "2026-09-10",
        source: "focusdesk",
        googleCalendarId: "primary",
        googleEventId: "google-2",
        syncStatus: "synced",
      },
    });
    const client = createGoogleCalendarClient(invoke);
    const event: CalendarEvent = {
      id: 2,
      title: "FocusDesk event",
      date: "2026-09-10",
      source: "focusdesk",
    };

    await client.create(configuration, event);
    expect(invoke).toHaveBeenCalledWith("googleCalendar.create", {
      clientId: configuration.clientId,
      scopes: configuration.scopes,
      calendarId: undefined,
      event,
    });
  });
});
