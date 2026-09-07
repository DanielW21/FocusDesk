# FocusDesk WaterlooWorks tool

This package is the first migration slice for WaterlooWorks. Its tables live in
FocusDesk's centralized SQLite database and it exposes the stable local-service
boundary that the future FocusDesk Jobs feature will consume.

## Current scope

- SQLite schema for jobs, evaluations, ratings, runs, and metadata.
- Idempotent import from the existing WaterlooWorks JSON files.
- Authenticated loopback API for health, capabilities, paginated jobs, job
  detail, and ratings.
- No scraper or LLM process is started yet; capabilities report those features
  as unavailable until their runners are migrated.

The implementation uses Node's built-in `node:sqlite` API and therefore
requires Node 22.5 or newer. The database is created at
`<data-dir>/focusdesk.sqlite3` with WAL mode and private directory permissions.
By default `<data-dir>` is `~/Library/Application Support/FocusDesk`.

## Import the existing store

```bash
npm run migrate --prefix tools/waterlooworks -- \
  --source=/Users/danielwu/Development/WaterlooWorks \
  --database=/Users/danielwu/Library/Application\\ Support/FocusDesk/focusdesk.sqlite3
```

The importer never modifies the source JSON files. It can be safely rerun.
To merge an existing separate WaterlooWorks database into the central database,
add `--from-database=/path/to/waterlooworks.sqlite3`. The old database is left
untouched as a backup.

## Run the local service

```bash
npm run service --prefix tools/waterlooworks -- \
  --database=/Users/danielwu/Library/Application\\ Support/FocusDesk/focusdesk.sqlite3
```

The first stdout line is an authenticated readiness record. The service binds
only to `127.0.0.1` and requires a bearer token on every request.
