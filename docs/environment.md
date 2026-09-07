# FocusDesk environment and secret hierarchy

FocusDesk follows the useful parts of Senpilot's local configuration pattern
without requiring 1Password.

## Files and storage locations

| Layer | Location | Purpose | Commit? |
| --- | --- | --- | --- |
| Template | `.env.example` | Names, defaults, and safety guidance | Yes |
| Local config | `.env.local` | Machine-specific development values | No |
| Public build config | `VITE_*` values | Values safe to bundle into the renderer | No |
| Native build config | non-`VITE_` values in `.env.local` | Values consumed while packaging the native app | No |
| User/account secrets | macOS Keychain | Google refresh token and future user tokens | No |
| Workspace data | `~/Library/Application Support/FocusDesk/` | Tasks, events, notes, and app data | No |

`.env.local` is a file at the repository root, next to `package.json`. Vite
loads it automatically for local development. It is ignored by `.gitignore`.

## What belongs in `.env.local`

Use `.env.local` for local configuration and public identifiers, for example:

```env
VITE_FOCUSDESK_ENV=local
VITE_FOCUSDESK_DEBUG=false
VITE_FOCUSDESK_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
VITE_FOCUSDESK_GOOGLE_SCOPES=https://www.googleapis.com/auth/calendar.events,https://www.googleapis.com/auth/calendar.calendarlist.readonly
FOCUSDESK_GOOGLE_CLIENT_SECRET=your-desktop-client-secret
# Optional: a stable macOS code-signing identity for local builds.
FOCUSDESK_CODESIGN_IDENTITY=FocusDesk Development
```

Every `VITE_*` value is potentially included in the browser bundle. This is
appropriate for a Google desktop OAuth client ID, but not for a refresh token,
API key, password, or private certificate.

`FOCUSDESK_GOOGLE_CLIENT_SECRET` is deliberately not prefixed with `VITE_`.
`build-native.sh` reads it only while packaging and embeds it in the native
macOS app's Info.plist so the renderer never receives it. Google desktop OAuth
clients are not confidential clients, but this keeps the value out of browser
JavaScript and source control.

## What must not go in `.env.local`

Do not store:

- Google refresh tokens
- OAuth access tokens
- service-account private keys
- API passwords or private API tokens
- downloaded Google credential JSON files

The native integration reads the Google refresh token through macOS Keychain and
exposes only typed actions through `src/platform/native-bridge.ts`. The
renderer should never receive a refresh token or other private credential.

## Adding a future integration

1. Add its public, non-secret configuration to `.env.example` with a
   `VITE_FOCUSDESK_` name only if the renderer truly needs it.
2. Add parsing and validation to `src/config/public-environment.ts` if the
   renderer needs the value.
3. Add a native integration under `native/Integrations/` for network calls and
   private credentials.
4. Store user/account tokens in Keychain using a stable service and account
   name, not in local storage or workspace backups.
5. Add the variable to the local template without adding a real value, then
   test that the value is absent from the built renderer when it is private.

The current Google client ID belongs in `.env.local`; the Google refresh token
is stored by the native integration in macOS Keychain after Google Calendar is
connected from Settings.

## Keychain prompts during local builds

The native package falls back to an ad-hoc signature when no code-signing
identity is available. macOS can treat each rebuilt ad-hoc binary as a new
Keychain client, so it may ask for the login Keychain password again. Choose
**Always Allow** for a stable build, or set `FOCUSDESK_CODESIGN_IDENTITY` to a
stable local signing identity (or a Developer ID Application identity) before
running `npm run package:mac`. The refresh token itself remains in Keychain;
do not move it into `.env.local`.
