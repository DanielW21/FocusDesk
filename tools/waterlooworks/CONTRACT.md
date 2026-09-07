# WaterlooWorks local API v1

Integration contract for Avicenna (native launch) and Banach (Jobs UI).

## Packaging and launch

From this package: `npm ci --ignore-scripts && npm run build`.
Outputs: `dist/server.js`, `dist/cli.js`, `dist/migrate-legacy.js`. Each bundles
its JavaScript dependencies; production does not need node_modules or the old
WaterlooWorks repository. Package a Node runtime >=22.5 alongside them. Launch:

```text
<bundled-node> --experimental-sqlite <resources>/waterlooworks/server.js --database=<Application Support>/FocusDesk/focusdesk.sqlite3 --config-dir=<Application Support>/FocusDesk/waterlooworks/config --port=0
```

Arguments are separate argv elements; paths may contain spaces. `--data-dir`
defaults to `~/Library/Application Support/FocusDesk`; it is the central data
directory, not the integration subdirectory. Optional `--token` or
`WW_SERVICE_TOKEN`; otherwise the service generates a token. Native must launch
one service per database. All endpoints require `Authorization: Bearer <token>`.
The server binds only 127.0.0.1. First stdout line:

```json
{"ready":true,"service":"waterlooworks","apiVersion":"v1","host":"127.0.0.1","port":12345,"url":"http://127.0.0.1:12345","token":"generated-token"}
```

Token is omitted when supplied by the launcher. Runtime warnings go to stderr.
SIGTERM/SIGINT cancel active work, close Chrome, then close the database/server.
Startup and all GET requests do not scrape or call a grading provider.

## Boards and jobs

Default board on jobs, summary, scrapes and grades: `Co-op`.
Canonical boards: `Co-op`, `Employer-Student Direct`, `Graduating and Full-Time`.
Aliases: `coop`, `direct`, `graduate`; `both` selects Co-op plus Direct; `all`
selects all boards. Keep board identity in every key: `Co-op:123`.

- `GET /api/v1/jobs?board=Co-op&q=developer&limit=50&cursor=0&minimumScore=0&rating=unranked`
  -> `{jobs: JobEntry[], page: {total: number, limit: number, nextCursor: string|null}}`.
  `rating` may be 1..5 or `unranked`; limit 1..10000; cursor is an offset.
- `GET /api/v1/jobs/:encodedJobKey` -> `{job: JobEntry}`; 404 if missing.
- `PUT /api/v1/jobs/:encodedJobKey/rating` with `{rating: 1..5|null, note?: string}`
  -> `{rating: {jobKey: string, rating: number|null}}`.
  Null explicitly clears manual ranking and returns the job to new/pending review.
- `GET /api/v1/ratings?board=all` -> `{[jobKey: string]: number}`; default all.

`JobEntry`: `{jobKey, board, job, firstSeenAt, lastSeenAt, lastChangedAt,
contentHash, isNew, grade?, rating?, ratingNote?, shortlisted?}`. `job` preserves
the full original scraped payload (id, jobTitle, company, location, descriptions,
charts, dates, url, etc.). `grade` preserves the AI evaluation (totalScore,
relevantCandidate, categoryScores, summary, evidence, confidence, etc.) plus
provider/model/promptHash/sourceHash. Manual `rating` is independent of `grade`.
Absent manual ratings are omitted; `isNew` is true for every manually unranked job.

## Summary

`GET /api/v1/summary?board=Co-op` -> directly:

```json
{"board":"Co-op","totalJobs":100,"newJobs":70,"rankedJobs":30,"gradedJobs":90,"needsGrading":10,"relevantJobs":50,"lastScrapedAt":"2026-09-07T12:00:00.000Z"}
```

`newJobs` counts all jobs whose manual rating is null/absent: newly discovered,
imported unranked, and explicitly unranked jobs. AI classifications do not affect
this count. `needsGrading` counts missing evaluations or stale source hashes;
explicit grading also checks current prompt/provider/model hashes. Last scraped
time is the maximum stored lastSeenAt, or null for an empty selection.

## Runs

- `POST /api/v1/scrapes` body `{board?: string}` -> 202 `{run: Run}`.
- `POST /api/v1/grades` body `{board?: string, all?: boolean, jobKey?: string}`
  -> 202 `{run: Run}`. `all` forces regrading within selected boards;
  jobKey targets one job and must match the board selector.
- `GET /api/v1/runs?limit=50&board=all` -> `{runs: Run[]}` newest first.
- `GET /api/v1/runs/:id` -> `{run: Run}`.
- `POST /api/v1/runs/:id/cancel` body `{}` -> 200 `{run: Run}`.

`Run`: `{id, type: 'scrape'|'grade', board, status, message, progress,
createdAt, updatedAt, completedAt: string|null, exitCode: number|null,
signal: string|null}`. Status: `queued`, `running`, `cancelling`, `completed`,
`failed`, `cancelled`, `interrupted`. Poll runs after starting/cancelling.
`progress` is extensible; grading uses `total`, `completed`, `graded`, `skipped`;
scraping uses `message`, `completed`, `total`, `added`, `changed` where available.
Terminal runs persist across restarts. In-flight runs become interrupted after
an unclean restart and are not resumed automatically. Only one active run is
accepted at a time; further starts return 409 `RUN_ACTIVE`.

## Capabilities and errors

`GET /api/v1/health` -> `{service:'waterlooworks', apiVersion:'v1', status:'ok'}`.
`GET /api/v1/capabilities` -> `{storage:{available:true,databasePath,schemaVersion},
jobs:{available:true},ratings:{available:true},scrape:Availability,grade:Availability}`.
Availability is `{available:boolean, reason?:string, code?:string}`. Missing local
Chrome/config/API credentials yields unavailable state; starting returns 503
`CONFIGURATION_UNAVAILABLE`. Secrets and candidate prompt content are never
returned. An available scraper may still require interactive Waterloo login.

Errors: `{error:{code:string,message:string,recoverable:boolean}}`.
400 invalid request; 401 unauthorized; 403 rejected origin; 404 missing resource;
409 active run; 415 unsupported content type; 503 configuration unavailable.
POST/PUT require `Content-Type: application/json`.
