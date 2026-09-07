const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { selectBoards } = require("./boards");

const SCHEMA_VERSION = "1";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashJob(job) {
  return crypto
    .createHash("sha256")
    .update(stableStringify(job))
    .digest("hex");
}

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function nestedText(value, key) {
  return isRecord(value) ? text(value[key]) : "";
}

function parseJobsPayload(payload) {
  const entries = Array.isArray(payload) ? payload : payload?.jobs;
  if (!Array.isArray(entries)) throw new Error("jobs.json must contain a jobs array");
  return entries.filter(isRecord);
}

function parseEvaluationsPayload(payload) {
  const entries = Array.isArray(payload)
    ? payload
    : payload?.evaluations || payload?.grades;
  if (!Array.isArray(entries)) return [];
  return entries.filter(isRecord);
}

function normaliseJob(entry, now) {
  const job = isRecord(entry.job) ? entry.job : entry;
  if (job.id === undefined || job.id === null || text(job.id) === "") return null;
  const board = text(entry.board) || "Unknown";
  const postingId = text(job.id);
  const contentHash = text(entry.contentHash) || hashJob(job);
  return {
    jobKey: `${board}:${postingId}`,
    board,
    postingId,
    job,
    jobJson: JSON.stringify(job),
    jobTitle: text(job.jobTitle || job.title),
    companyName: nestedText(job.company, "name") || text(job.companyName),
    locationText:
      (isRecord(job.location) ? Object.values(job.location).filter(Boolean).join(", ") : text(job.location)) ||
      text(job.locations) ||
      text(job.locationText),
    jobUrl: text(job.url || job.jobUrl),
    firstSeenAt: text(entry.firstSeenAt) || now,
    lastSeenAt: text(entry.lastSeenAt) || now,
    lastChangedAt: text(entry.lastChangedAt) || now,
    contentHash,
  };
}

function asNullableNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asNullableBoolean(value) {
  return typeof value === "boolean" ? (value ? 1 : 0) : null;
}

class WaterlooWorksSqliteStore {
  constructor(dataDirectory, databasePath) {
    this.dataDirectory = path.resolve(dataDirectory || path.dirname(databasePath || "."));
    this.databasePath = path.resolve(
      databasePath || path.join(this.dataDirectory, "focusdesk.sqlite3"),
    );
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(this.databasePath);
    try {
      fs.chmodSync(this.databasePath, 0o600);
    } catch (error) {
      // The native app may already own the central database. Reusing it should
      // not fail just because a sandbox or another process denies chmod.
      if (error?.code !== "EPERM" && error?.code !== "EACCES") throw error;
    }
    this.database.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS jobs (
        job_key TEXT PRIMARY KEY,
        board TEXT NOT NULL,
        posting_id TEXT NOT NULL,
        job_json TEXT NOT NULL,
        job_title TEXT NOT NULL DEFAULT '',
        company_name TEXT NOT NULL DEFAULT '',
        location_text TEXT NOT NULL DEFAULT '',
        job_url TEXT NOT NULL DEFAULT '',
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        last_changed_at TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        UNIQUE (board, posting_id)
      );
      CREATE TABLE IF NOT EXISTS evaluations (
        job_key TEXT PRIMARY KEY REFERENCES jobs(job_key) ON DELETE CASCADE,
        evaluation_json TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        prompt_hash TEXT,
        source_hash TEXT,
        total_score REAL,
        relevant_candidate INTEGER,
        confidence TEXT,
        evaluated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ratings (
        job_key TEXT PRIMARY KEY REFERENCES jobs(job_key) ON DELETE CASCADE,
        rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
        shortlisted INTEGER NOT NULL DEFAULT 0 CHECK (shortlisted IN (0, 1)),
        note TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('scrape', 'grade')),
        board TEXT,
        status TEXT NOT NULL,
        message TEXT,
        progress_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        exit_code INTEGER,
        signal TEXT
      );
      CREATE INDEX IF NOT EXISTS jobs_board_index ON jobs(board);
      CREATE INDEX IF NOT EXISTS jobs_title_index ON jobs(job_title COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS jobs_company_index ON jobs(company_name COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS jobs_changed_index ON jobs(last_changed_at DESC);
      CREATE INDEX IF NOT EXISTS evaluations_score_index ON evaluations(total_score DESC);
      CREATE INDEX IF NOT EXISTS evaluations_relevant_index ON evaluations(relevant_candidate);
      CREATE INDEX IF NOT EXISTS ratings_rating_index ON ratings(rating);
    `);
    this.setMetadata("waterlooworks_schema_version", SCHEMA_VERSION);
  }

  setMetadata(key, value) {
    this.database
      .prepare("INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, typeof value === "string" ? value : JSON.stringify(value));
  }

  getMetadata(key) {
    return this.database.prepare("SELECT value FROM metadata WHERE key = ?").get(key)?.value;
  }

  upsertJob(entry, now = new Date().toISOString()) {
    const job = normaliseJob(entry, now);
    if (!job) return false;
    const existing = this.database
      .prepare("SELECT first_seen_at, content_hash, last_changed_at FROM jobs WHERE job_key = ?")
      .get(job.jobKey);
    const lastChangedAt =
      existing && existing.content_hash === job.contentHash
        ? existing.last_changed_at
        : job.lastChangedAt;
    this.database
      .prepare(`
        INSERT INTO jobs (
          job_key, board, posting_id, job_json, job_title, company_name,
          location_text, job_url, first_seen_at, last_seen_at, last_changed_at, content_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_key) DO UPDATE SET
          board = excluded.board,
          posting_id = excluded.posting_id,
          job_json = excluded.job_json,
          job_title = excluded.job_title,
          company_name = excluded.company_name,
          location_text = excluded.location_text,
          job_url = excluded.job_url,
          last_seen_at = excluded.last_seen_at,
          last_changed_at = excluded.last_changed_at,
          content_hash = excluded.content_hash
      `)
      .run(
        job.jobKey,
        job.board,
        job.postingId,
        job.jobJson,
        job.jobTitle,
        job.companyName,
        job.locationText,
        job.jobUrl,
        existing?.first_seen_at || job.firstSeenAt,
        job.lastSeenAt,
        lastChangedAt,
        job.contentHash,
      );
    return true;
  }

  upsertEvaluation(jobKey, evaluation, fallback = {}) {
    if (!isRecord(evaluation)) return false;
    if (!this.database.prepare("SELECT 1 FROM jobs WHERE job_key = ?").get(jobKey)) return false;
    const evaluatedAt = text(evaluation.evaluatedAt) || new Date().toISOString();
    this.database
      .prepare(`
        INSERT INTO evaluations (
          job_key, evaluation_json, provider, model, prompt_hash, source_hash,
          total_score, relevant_candidate, confidence, evaluated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_key) DO UPDATE SET
          evaluation_json = excluded.evaluation_json,
          provider = excluded.provider,
          model = excluded.model,
          prompt_hash = excluded.prompt_hash,
          source_hash = excluded.source_hash,
          total_score = excluded.total_score,
          relevant_candidate = excluded.relevant_candidate,
          confidence = excluded.confidence,
          evaluated_at = excluded.evaluated_at
      `)
      .run(
        jobKey,
        JSON.stringify(evaluation),
        text(evaluation.provider) || text(fallback.provider) || null,
        text(evaluation.model) || text(fallback.model) || null,
        text(evaluation.promptHash) || null,
        text(evaluation.sourceHash) || null,
        asNullableNumber(evaluation.totalScore),
        asNullableBoolean(evaluation.relevantCandidate),
        text(evaluation.confidence) || null,
        evaluatedAt,
      );
    return true;
  }

  setRating(jobKey, rating, note) {
    if (!this.database.prepare("SELECT 1 FROM jobs WHERE job_key = ?").get(jobKey)) return null;
    if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
      throw new Error("rating must be null or an integer from 1 to 5");
    }
    this.database
      .prepare(`
        INSERT INTO ratings(job_key, rating, note, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(job_key) DO UPDATE SET rating = excluded.rating, note = COALESCE(excluded.note, ratings.note), updated_at = excluded.updated_at
      `)
      .run(jobKey, rating, note === undefined ? null : text(note), new Date().toISOString());
    return { jobKey, rating };
  }

  listJobs({ q = "", board, minimumScore = 0, rating, limit = 50, offset = 0 } = {}) {
    const clauses = [];
    const parameters = [];
    const query = text(q).toLowerCase();
    if (query) {
      clauses.push("(LOWER(j.job_title) LIKE ? OR LOWER(j.company_name) LIKE ? OR LOWER(j.location_text) LIKE ?)");
      const pattern = `%${query}%`;
      parameters.push(pattern, pattern, pattern);
    }
    if (board) {
      const boards = selectBoards(board);
      if (board !== "all") {
        clauses.push(`j.board IN (${boards.map(() => "?").join(",")})`);
        parameters.push(...boards);
      }
    }
    if (minimumScore) {
      clauses.push("e.total_score >= ?");
      parameters.push(minimumScore);
    }
    if (rating !== undefined && rating !== "") {
      if (rating === "unranked") clauses.push("r.rating IS NULL");
      else { clauses.push("r.rating = ?"); parameters.push(rating); }
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const count = this.database
      .prepare(`SELECT COUNT(*) AS total FROM jobs j LEFT JOIN evaluations e ON e.job_key = j.job_key LEFT JOIN ratings r ON r.job_key = j.job_key ${where}`)
      .get(...parameters).total;
    const rows = this.database
      .prepare(`
        SELECT j.*, e.evaluation_json, e.provider, e.model, e.prompt_hash,
          e.source_hash, e.total_score, e.relevant_candidate, e.confidence,
          e.evaluated_at, r.rating, r.shortlisted, r.note AS rating_note
        FROM jobs j
        LEFT JOIN evaluations e ON e.job_key = j.job_key
        LEFT JOIN ratings r ON r.job_key = j.job_key
        ${where}
        ORDER BY j.last_changed_at DESC, j.job_title COLLATE NOCASE ASC, j.job_key ASC
        LIMIT ? OFFSET ?
      `)
      .all(...parameters, Math.min(10000, Math.max(1, limit)), Math.max(0, offset));
    return { jobs: rows.map((row) => this.#toEntry(row)), total: Number(count) };
  }

  getJob(jobKey) {
    const row = this.database
      .prepare(`
        SELECT j.*, e.evaluation_json, e.provider, e.model, e.prompt_hash,
          e.source_hash, e.total_score, e.relevant_candidate, e.confidence,
          e.evaluated_at, r.rating, r.shortlisted, r.note AS rating_note
        FROM jobs j
        LEFT JOIN evaluations e ON e.job_key = j.job_key
        LEFT JOIN ratings r ON r.job_key = j.job_key
        WHERE j.job_key = ?
      `)
      .get(jobKey);
    return row ? this.#toEntry(row) : null;
  }

  stats() {
    const row = this.database
      .prepare(`
        SELECT
          (SELECT COUNT(*) FROM jobs) AS jobs,
          (SELECT COUNT(*) FROM evaluations) AS evaluations,
          (SELECT COUNT(*) FROM ratings) AS ratings,
          (SELECT COUNT(*) FROM evaluations WHERE total_score IS NOT NULL) AS scored
      `)
      .get();
    return {
      jobs: Number(row.jobs),
      evaluations: Number(row.evaluations),
      ratings: Number(row.ratings),
      scored: Number(row.scored),
    };
  }

  summary(board = "Co-op") {
    const boards = selectBoards(board);
    const where = board === "all" ? "" : `WHERE j.board IN (${boards.map(() => "?").join(",")})`;
    const row = this.database.prepare(`SELECT COUNT(*) AS totalJobs,
      COALESCE(SUM(r.rating IS NULL), 0) AS newJobs,
      COALESCE(SUM(r.rating IS NOT NULL), 0) AS rankedJobs,
      COALESCE(SUM(e.job_key IS NOT NULL), 0) AS gradedJobs,
      COALESCE(SUM(e.job_key IS NULL OR e.source_hash IS NULL OR e.source_hash <> j.content_hash), 0) AS needsGrading,
      COALESCE(SUM(e.relevant_candidate = 1), 0) AS relevantJobs,
      MAX(j.last_seen_at) AS lastScrapedAt
      FROM jobs j LEFT JOIN ratings r ON r.job_key = j.job_key
      LEFT JOIN evaluations e ON e.job_key = j.job_key ${where}`).get(...(board === "all" ? [] : boards));
    return { board, ...row };
  }

  listRatings(board = "all") {
    const boards = selectBoards(board);
    return Object.fromEntries(this.database.prepare(`SELECT r.job_key, r.rating FROM ratings r
      JOIN jobs j ON j.job_key = r.job_key WHERE r.rating IS NOT NULL
      ${board === "all" ? "" : `AND j.board IN (${boards.map(() => "?").join(",")})`}`)
      .all(...(board === "all" ? [] : boards)).map(row => [row.job_key, row.rating]));
  }

  createRun(type, board, options = {}) {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    this.database.prepare(`INSERT INTO runs(id, type, board, status, message, progress_json, created_at, updated_at)
      VALUES (?, ?, ?, 'queued', 'Queued', ?, ?, ?)`).run(id, type, board, JSON.stringify({ options }), now, now);
    return this.getRun(id);
  }

  updateRun(id, { status, message, progress, exitCode, signal } = {}) {
    const current = this.getRun(id);
    if (!current) return null;
    const nextStatus = status || current.status;
    const now = new Date().toISOString();
    const terminal = ["completed", "failed", "cancelled", "interrupted"].includes(nextStatus);
    this.database.prepare(`UPDATE runs SET status = ?, message = ?, progress_json = ?, updated_at = ?,
      completed_at = ?, exit_code = ?, signal = ? WHERE id = ?`).run(nextStatus, message ?? current.message,
      JSON.stringify({ ...current.progress, ...progress }), now, terminal ? (current.completedAt || now) : null,
      exitCode ?? current.exitCode, signal ?? current.signal, id);
    return this.getRun(id);
  }

  getRun(id) {
    const row = this.database.prepare("SELECT * FROM runs WHERE id = ?").get(id);
    return row ? { id: row.id, type: row.type, board: row.board, status: row.status, message: row.message,
      progress: JSON.parse(row.progress_json || "{}"), createdAt: row.created_at, updatedAt: row.updated_at,
      completedAt: row.completed_at, exitCode: row.exit_code, signal: row.signal } : null;
  }

  listRuns({ limit = 50, board } = {}) {
    const boards = board ? selectBoards(board) : [];
    return this.database.prepare(`SELECT id FROM runs
      ${boards.length && board !== "all" ? `WHERE board IN (${[...boards, "both", "all"].map(() => "?").join(",")})` : ""}
      ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(
      ...(boards.length && board !== "all" ? [...boards, "both", "all"] : []), limit,
    ).map(row => this.getRun(row.id));
  }

  interruptRuns() {
    this.database.prepare(`UPDATE runs SET status = 'interrupted', message = 'Service stopped before completion',
      updated_at = ?, completed_at = ? WHERE status IN ('queued', 'running', 'cancelling')`)
      .run(new Date().toISOString(), new Date().toISOString());
  }

  importDatabase(sourceDatabasePath) {
    const sourcePath = path.resolve(sourceDatabasePath);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`The source WaterlooWorks database does not exist: ${sourcePath}`);
    }
    if (sourcePath === this.databasePath) {
      throw new Error("The source WaterlooWorks database must be different from the central database.");
    }

    const before = this.stats();
    this.database.prepare("ATTACH DATABASE ? AS legacy_waterlooworks").run(sourcePath);
    try {
      this.database.exec("BEGIN IMMEDIATE");
      this.database.exec(`
        INSERT OR IGNORE INTO jobs (
          job_key, board, posting_id, job_json, job_title, company_name,
          location_text, job_url, first_seen_at, last_seen_at, last_changed_at, content_hash
        )
        SELECT job_key, board, posting_id, job_json, job_title, company_name,
          location_text, job_url, first_seen_at, last_seen_at, last_changed_at, content_hash
        FROM legacy_waterlooworks.jobs;
        INSERT OR IGNORE INTO evaluations (
          job_key, evaluation_json, provider, model, prompt_hash, source_hash,
          total_score, relevant_candidate, confidence, evaluated_at
        )
        SELECT evaluation.job_key, evaluation.evaluation_json, evaluation.provider,
          evaluation.model, evaluation.prompt_hash, evaluation.source_hash,
          evaluation.total_score, evaluation.relevant_candidate, evaluation.confidence,
          evaluation.evaluated_at
        FROM legacy_waterlooworks.evaluations AS evaluation
        INNER JOIN jobs ON jobs.job_key = evaluation.job_key;
        INSERT OR IGNORE INTO ratings (
          job_key, rating, shortlisted, note, updated_at
        )
        SELECT rating.job_key, rating.rating, rating.shortlisted, rating.note, rating.updated_at
        FROM legacy_waterlooworks.ratings AS rating
        INNER JOIN jobs ON jobs.job_key = rating.job_key;
        INSERT OR IGNORE INTO runs (
          id, type, board, status, message, progress_json, created_at,
          updated_at, completed_at, exit_code, signal
        )
        SELECT id, type, board, status, message, progress_json, created_at,
          updated_at, completed_at, exit_code, signal
        FROM legacy_waterlooworks.runs;
      `);
      const after = this.stats();
      this.setMetadata("waterlooworks_legacy_database_migrated", {
        source: sourcePath,
        migratedAt: new Date().toISOString(),
        imported: {
          jobs: after.jobs - before.jobs,
          evaluations: after.evaluations - before.evaluations,
          ratings: after.ratings - before.ratings,
        },
      });
      this.database.exec("COMMIT");
      return {
        jobs: after.jobs - before.jobs,
        evaluations: after.evaluations - before.evaluations,
        ratings: after.ratings - before.ratings,
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    } finally {
      this.database.exec("DETACH DATABASE legacy_waterlooworks");
    }
  }

  migrateLegacy({ jobsPath, gradesPath, ratingsPath }) {
    const now = new Date().toISOString();
    const jobsPayload = readJson(jobsPath, { jobs: [] });
    const gradesPayload = readJson(gradesPath, { evaluations: [] });
    const ratingsPayload = readJson(ratingsPath, {});
    const entries = parseJobsPayload(jobsPayload);
    const evaluations = parseEvaluationsPayload(gradesPayload);
    const ratings = isRecord(ratingsPayload) ? ratingsPayload : {};
    const imported = { jobs: 0, evaluations: 0, ratings: 0, skipped: 0, unmatchedRatings: [] };
    const ids = new Map();

    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const entry of entries) {
        const normalised = normaliseJob(entry, now);
        if (!normalised) {
          imported.skipped++;
          continue;
        }
        // Re-imports must not revert newer scraped data or manual review decisions.
        if (!this.getJob(normalised.jobKey)) this.upsertJob(entry, now);
        imported.jobs++;
        const matches = ids.get(normalised.postingId) || [];
        matches.push(normalised.jobKey);
        ids.set(normalised.postingId, matches);
      }

      for (const evaluation of evaluations) {
        const postingId = text(evaluation.jobId ?? evaluation.id);
        const board = text(evaluation.board);
        const candidates = board
          ? [`${board}:${postingId}`]
          : ids.get(postingId) || [];
        const jobKey = candidates.length === 1 ? candidates[0] : `${board}:${postingId}`;
        if (!this.getJob(jobKey)?.grade && !this.upsertEvaluation(jobKey, evaluation, gradesPayload)) {
          imported.skipped++;
          continue;
        }
        imported.evaluations++;
      }

      for (const [key, value] of Object.entries(ratings)) {
        const direct = this.getJob(key) ? key : null;
        const candidates = direct
          ? [direct]
          : ids.get(key) || [];
        const jobKey = candidates.length === 1 ? candidates[0] : null;
        if (!jobKey || !Number.isInteger(value) || value < 1 || value > 5) {
          imported.unmatchedRatings.push({ key, value });
          continue;
        }
        if (!this.database.prepare("SELECT 1 FROM ratings WHERE job_key = ?").get(jobKey)) this.setRating(jobKey, value);
        imported.ratings++;
      }

      this.setMetadata("legacy_migration", {
        completedAt: now,
        sources: { jobsPath, gradesPath, ratingsPath },
        imported,
      });
      if (imported.unmatchedRatings.length) {
        this.setMetadata("legacy_unmatched_ratings", imported.unmatchedRatings);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return imported;
  }

  #toEntry(row) {
    const job = JSON.parse(row.job_json);
    const entry = {
      jobKey: row.job_key,
      board: row.board,
      job,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      lastChangedAt: row.last_changed_at,
      contentHash: row.content_hash,
    };
    if (row.evaluation_json) entry.grade = { ...JSON.parse(row.evaluation_json),
      provider: row.provider, model: row.model, promptHash: row.prompt_hash, sourceHash: row.source_hash };
    entry.isNew = row.rating === null || row.rating === undefined;
    if (row.rating !== null && row.rating !== undefined) entry.rating = row.rating;
    if (row.shortlisted) entry.shortlisted = Boolean(row.shortlisted);
    if (row.rating_note !== null && row.rating_note !== undefined) entry.ratingNote = row.rating_note;
    return entry;
  }

  close() {
    this.database.close();
  }
}

module.exports = {
  WaterlooWorksSqliteStore,
  hashJob,
  normaliseJob,
  stableStringify,
};
