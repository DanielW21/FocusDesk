---
name: focusdesk-worktrees
description: Set up and debug FocusDesk across Git worktrees, multiple terminals, Vite sessions, and packaged macOS builds while keeping code paths, launch targets, and runtime data boundaries clear. Use for parallel FocusDesk feature work, branch debugging, app rebuilds, or duplicate-app confusion; do not use for ordinary single-worktree edits.
---

# FocusDesk Worktrees

Use this skill under the repository root `AGENTS.md`. It is a project-local playbook for separating source work, development servers, packaged app artifacts, and runtime data. Do not change the root agent instructions merely to create another worktree.

## Core model

Keep `/Users/danielwu/Development/FocusDesk` as the local `main` checkout. Use one sibling worktree per independent task:

```text
/Users/danielwu/Development/FocusDesk/                 # main
/Users/danielwu/Development/FocusDesk-wt-notes/        # feature branch
/Users/danielwu/Development/FocusDesk-wt-calendar/     # debugging branch
```

Every terminal must be attached to the intended worktree. Before changing files or launching a build, verify:

```sh
pwd
git branch --show-current
git worktree list
```

Do not assume that the current directory, a shell alias, `/Applications/FocusDesk.app`, or a running server belongs to the intended branch.

## Start parallel work

From clean local `main`, create a task worktree and install dependencies there:

```sh
cd /Users/danielwu/Development/FocusDesk
git status --short --branch
git worktree add -b feat/<short-name> \
  /Users/danielwu/Development/FocusDesk-wt-<short-name> main
cd /Users/danielwu/Development/FocusDesk-wt-<short-name>
npm install
```

Use separate terminals for the same worktree: a Vite server, `npm test -- --watch`, typecheck/lint/build checks, and Git/native-log inspection. Use a unique Vite port when multiple worktrees run servers:

```sh
npm run dev -- --port 5174
```

Choose ports deliberately and record which worktree owns each server. Kill or reuse a server only after confirming its PID and working directory.

## Development versus packaged apps

For ordinary UI work, use Vite. For native bridge, SQLite, Keychain, WebView persistence, or packaging behavior, build and launch from the exact worktree under test:

```sh
npm run package:mac
open -n /Users/danielwu/Development/FocusDesk-wt-<short-name>/release/FocusDesk.app
```

`build-native.sh` packages into the invoking worktree's `release/` directory. Prefer absolute app paths. `/Applications/FocusDesk.app` is only one symlink or installed copy and cannot represent multiple worktrees at once. Inspect it with:

```sh
ls -ld /Applications/FocusDesk.app
readlink /Applications/FocusDesk.app
```

Do not repoint or replace that symlink unless the user explicitly asks for launcher cleanup. Do not infer that an app opened from `/Applications` contains the current `main` build.

## Runtime isolation warning

Separate worktrees and separate `.app` paths isolate source and build artifacts, but the current packaged app does not fully isolate runtime data. These values are shared unless the native app is changed to support profiles:

- bundle identifier: `com.danielwu.focusdesk`;
- FocusDesk Application Support database directory;
- TaskManager data location;
- Google Calendar Keychain service; and
- potentially WebView/localStorage data tied to the app identity.

Do not run multiple packaged FocusDesk builds concurrently when data or native integrations matter. Use Vite sessions for parallel UI work and one packaged build at a time for native verification.

If simultaneous packaged profiles are required, implement an explicit profile boundary instead of relying on worktree paths. The profile must consistently change the display name, bundle identifier, Application Support directory, TaskManager data path, Keychain service, window autosave name, and WebView storage identity. Inspect `build-native.sh`, `native/Info.plist`, `native/Database/`, `native/Integrations/`, and `native/main.m` first.

## Merge and cleanup

Commit only intended worktree changes, then merge from local `main`:

```sh
git status --short --branch
git add <intended-files>
git commit -m "Describe the change"
cd /Users/danielwu/Development/FocusDesk
git merge --no-ff <branch>
```

Before handoff, run the repository checks from the worktree containing the change:

```sh
npm run tsc:check
npm test
npm run lint
npm run format
npm run build
```

Only remove a worktree after checking it is clean and confirming the branch is merged or intentionally preserved:

```sh
git worktree list
git status --short --branch
git worktree remove /Users/danielwu/Development/FocusDesk-wt-<short-name>
```

Preserve dirty user changes. Do not delete a worktree, branch, app bundle, database, or Keychain data merely to resolve duplicate-app confusion.
