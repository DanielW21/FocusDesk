# Google Calendar integration plan

Status: native sync and the first Calendar UI pass are implemented. The local
client ID lives in ignored `.env.local`; no refresh token is stored in the
repository.

## Current implementation

- Calendar UI and `.ics` import: `src/main.ts`
  - `calendarView()` renders the calendar.
  - `eventsFor()` renders the selected day's events.
  - The `#ics-input` handler parses imported events.
- Calendar event type and validation: `src/features/workspace/model.ts`
- Local event persistence and migration: `src/app/app-database.ts`
- Typed WebView/native boundary: `src/platform/native-bridge.ts`
- Native message routing: `native/Bridge/FDMessageBridge.m`
- Native macOS OAuth callback/window handling: `native/main.m`
- App URL-scheme configuration: `native/Info.plist`
- Native build/package wiring: `build-native.sh`
- Integration process/service boundary reserved by the project: `native/Integrations/`
- Native Google Calendar client: `native/Integrations/FDGoogleCalendarClient.m`
- Renderer-safe Google configuration: `src/config/public-environment.ts`
- Google sync/reconciliation rules: `src/features/workspace/calendar-sync.ts`
- Typed renderer client: `src/features/workspace/google-calendar-client.ts`

The app still imports `.ics` events as a fallback. The packaged native app can
connect through Settings, list selectable calendars, sync selected calendars on
startup, and push explicitly-created FocusDesk events without writing inbound
Google events back.

## One-time Google setup

1. Create or select a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com).
3. Configure the OAuth consent screen. Use the narrowest scope that supports the
   intended feature:
   - Recommended: `https://www.googleapis.com/auth/calendar.events`
   - To show the calendar checklist in Settings, also add:
     `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
   - More restrictive if only calendars owned by the user are supported:
     `https://www.googleapis.com/auth/calendar.events.owned`
4. Create an OAuth client with application type **Desktop app**.
5. Provide FocusDesk the OAuth client ID and desktop client secret through
   ignored local configuration. Do not commit credentials. The client secret is
   required by this token endpoint; it is consumed only by the native build and
   is never sent to the renderer.
6. The app should request consent in the system browser and use the supported
   desktop loopback callback. Store the resulting refresh token in macOS
   Keychain, never in `localStorage` or the workspace JSON backup.

References:

- [Google Calendar authentication and authorization](https://developers.google.com/workspace/calendar/api/auth)
- [Google OAuth 2.0 for installed applications](https://developers.google.com/identity/protocols/oauth2)
- [Google OAuth loopback migration guidance](https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration)
- [Google Calendar OAuth scopes](https://developers.google.com/identity/protocols/oauth2/scopes)
- [Google Calendar `events.insert` reference](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)

## Implementation phases

### 1. Native Google Calendar client — implemented

The first pass adds a Google Calendar integration under
`native/Integrations/FDGoogleCalendarClient.m` and exposes typed actions through
`native/Bridge/FDMessageBridge.m` and the renderer client:

- connection status and account identity
- start OAuth / disconnect
- insert, update, delete, and incrementally list Google events
- refresh access tokens using the Keychain refresh token

Calendar listing and choosing non-primary calendars are implemented in Settings.
The first connection selects all calendars returned by Google; subsequent
checkbox changes are persisted locally.

The native layer owns OAuth tokens and network calls. OAuth uses the system
browser, PKCE, and a loopback callback. The renderer receives validated event
data and status only. Refresh tokens are stored in macOS Keychain.

### 2. Event identity and sync metadata — implemented

Extend `CalendarEvent` in `src/features/workspace/model.ts` and its Zod schema
with optional, backward-compatible fields:

- `source`: `focusdesk`, `google`, or `ics`
- `googleCalendarId`
- `googleEventId`
- Google `iCalUID`
- local FocusDesk event ID used as the correlation marker

Existing imported events must continue loading unchanged.

### 3. Calendar UI — implemented

`settingsView()` and `calendarView()` in `src/main.ts` now provide:

- Google Calendar connection status
- calendar selector
- explicit “Add event” form
- “Sync now” action
- clear read-only labels for externally-owned Google/ICS events

Keep `.ics` import available as a fallback until API sync is proven stable.

### 4. Loop prevention contract — implemented in the sync boundary

This is mandatory:

- A FocusDesk-created event makes exactly one `events.insert` request.
- Outbound events include a private `focusdeskEventId` correlation property.
- A pulled Google event is reconciled locally only; pulling never calls insert
  or update automatically.
- Match pulled events in this order:
  1. `googleCalendarId` + `googleEventId`
  2. private `focusdeskEventId` marker
  3. Google `iCalUID` within the same calendar
- If matched, update the existing local record while preserving its local ID.
- If unmatched, add it as `source: "google"` and do not write it back.
- Only explicit user edits to `source: "focusdesk"` events may call Google
  `events.update`.
- Events from `.ics` and externally-created Google events are inbound-only.
- Retrying an interrupted insert must reconcile by the correlation marker, not
  create a second event.

Expected behavior:

| Operation | Google write | Local result |
| --- | --- | --- |
| Add FocusDesk event | One insert | Save returned Google ID |
| Pull the same event | None | Update existing event |
| Pull it repeatedly | None | No duplicate |
| Pull external Google event | None | Add read-only event |
| Edit owned FocusDesk event | One update | Save new sync metadata |

### 5. Verification

Unit tests cover repeated pulls, interrupted inserts, matching by Google event
ID/marker/iCalUID, remote deletion, and the rule that inbound sync never causes
an outbound request. Continue running the repository checks from `AGENTS.md`:

```sh
npm run tsc:check
npm test
npm run lint
npm run format
npm run build
npm run package:mac
```

## Remaining setup input

The Google Cloud Desktop OAuth client ID is present in local configuration. Add
the calendar-list scope to the OAuth consent screen, launch the packaged app,
open Settings, and use Connect Google. If an older token was already created,
use Reconnect once so Google grants the new scope.
