# FocusDesk

A private, laptop-first workspace for tasks, daily focus, Google Calendar events, scratch notes, and quick links.

## Launch

For browser development, run:

```sh
npm install
npm run dev
```

Then open <http://localhost:5173>.

The app is written in TypeScript and uses Vite for local development and builds.

## Project layout

- `src/` — TypeScript application and interface styles
- `assets/` — source app icon
- `native/` — lightweight macOS WebKit wrapper and packaging helpers
- `release/` — generated app and installer

## macOS app

Create the native Apple silicon app and installer package with:

```sh
npm run package:mac
```

The finished `.app`, `.pkg`, and `.zip` are written to `release/`. If
`FOCUSDESK_CODESIGN_IDENTITY` is set in `.env.local`, the app uses that stable
identity; otherwise it is ad-hoc signed for local use and macOS may ask for
Keychain approval again after a rebuild.

In the packaged macOS app, FocusDesk tasks and TaskManager courses are stored in native SQLite at
`~/Library/Application Support/FocusDesk/focusdesk.sqlite3`. The native bridge
owns the database and all task-manager mutations go through typed SQLite actions. Browser
development uses the versioned `focusdesk-db-v1` WebKit-local-storage document
as a fallback and migration mirror. Its tables contain FocusDesk tasks,
calendar events, scratch notes, and quick links; dashboard layout and settings
are stored alongside them. The previous `focusdesk-v1` workspace is migrated
automatically on launch. If an older TaskManager JSON path is still registered,
its courses and tasks are imported once into SQLite without requiring the old
tool. Use **Export backup** to save a JSON backup. Calendar import accepts
Google Calendar `.ics` exports as a fallback. The native macOS build now has a
Google Calendar OAuth/API boundary with Keychain-backed refresh-token storage,
incremental startup pulls, provider IDs, and FocusDesk correlation metadata.
Google pulls reconcile local events without writing them back, while only
explicitly FocusDesk-owned events are eligible for Google insert/update
operations. Settings can connect Google Calendar, choose which calendars to
pull, sync on startup, and sync manually. The Calendar view can create and edit
FocusDesk-owned events; Google-owned and `.ics` events remain read-only.

Use **Settings** in the sidebar to change the theme, accent color, interface density, Focus timer length, TaskManager defaults, and each dashboard widget's visibility or dimensions. Settings are saved with the rest of the local workspace.

Quick Links use a compact three-column layout on desktop. Each link can have its own colour and an uploaded icon image. Existing image URL/path assets remain compatible. The dashboard Quick Links widget makes each icon directly clickable.

## Checks

Run the same checks used by GitHub Actions before opening a pull request:

```sh
npm ci
npm run tsc:check
npm test
npm run lint
npm run format
```

The macOS package can be built locally with `npm run package:mac`. It requires macOS tooling such as
Clang, `sips`, `pkgbuild`, and an installed Chrome/Chromium executable for WaterlooWorks development work.
