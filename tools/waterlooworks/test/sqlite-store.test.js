const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { WaterlooWorksSqliteStore } = require("../src/sqlite-store");

function makeStore(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "focusdesk-ww-"));
  const store = new WaterlooWorksSqliteStore(directory);
  t.after(() => {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { directory, store };
}

const job = (board, id, title = "Developer") => ({
  board,
  job: {
    id,
    url: `https://example.test/${id}`,
    jobTitle: title,
    company: { name: "Example Co" },
    location: "Waterloo",
  },
});

test("upserts jobs without duplicating stable board/id keys", (t) => {
  const { store } = makeStore(t);
  assert.equal(store.upsertJob(job("Co-op", "42")), true);
  assert.equal(store.upsertJob(job("Co-op", "42", "Updated Developer")), true);
  assert.equal(store.upsertJob(job("Direct", "42")), true);

  const result = store.listJobs({ limit: 10 });
  assert.equal(result.total, 2);
  assert.deepEqual(
    result.jobs.map((entry) => `${entry.board}:${entry.job.id}`).sort(),
    ["Co-op:42", "Direct:42"],
  );
  assert.equal(result.jobs.find((entry) => entry.board === "Co-op").job.jobTitle, "Updated Developer");
});

test("joins evaluations and ratings while preserving the original job payload", (t) => {
  const { store } = makeStore(t);
  store.upsertJob(job("Co-op", "42"));
  store.upsertEvaluation("Co-op:42", {
    board: "Co-op",
    jobId: "42",
    totalScore: 91,
    relevantCandidate: true,
    evaluatedAt: "2026-01-02T00:00:00.000Z",
  });
  assert.deepEqual(store.setRating("Co-op:42", 5), { jobKey: "Co-op:42", rating: 5 });

  const result = store.listJobs({ minimumScore: 90, rating: 5, limit: 10 });
  assert.equal(result.total, 1);
  assert.equal(result.jobs[0].job.company.name, "Example Co");
  assert.equal(result.jobs[0].grade.totalScore, 91);
  assert.equal(result.jobs[0].rating, 5);
});

test("imports legacy JSON idempotently and records unmatched ratings", (t) => {
  const { directory, store } = makeStore(t);
  const jobsPath = path.join(directory, "jobs.json");
  const gradesPath = path.join(directory, "graded-jobs.json");
  const ratingsPath = path.join(directory, "ratings.json");
  fs.writeFileSync(jobsPath, JSON.stringify({ version: 1, jobs: [job("Co-op", "42"), job("Direct", "42")] }));
  fs.writeFileSync(gradesPath, JSON.stringify({ evaluations: [{ board: "Co-op", jobId: "42", totalScore: 88 }] }));
  fs.writeFileSync(ratingsPath, JSON.stringify({ "Co-op:42": 4, "missing:9": 5 }));

  const first = store.migrateLegacy({ jobsPath, gradesPath, ratingsPath });
  const second = store.migrateLegacy({ jobsPath, gradesPath, ratingsPath });
  assert.deepEqual(first, { jobs: 2, evaluations: 1, ratings: 1, skipped: 0, unmatchedRatings: [{ key: "missing:9", value: 5 }] });
  assert.deepEqual(second, { jobs: 2, evaluations: 1, ratings: 1, skipped: 0, unmatchedRatings: [{ key: "missing:9", value: 5 }] });
  assert.deepEqual(store.stats(), { jobs: 2, evaluations: 1, ratings: 1, scored: 1 });
  assert.match(store.getMetadata("legacy_migration"), /completedAt/);
});

test("does not guess an evaluation when an id exists on multiple boards", (t) => {
  const { store } = makeStore(t);
  store.upsertJob(job("Co-op", "42"));
  store.upsertJob(job("Direct", "42"));
  const result = store.migrateLegacy({
    jobsPath: path.join(t.name || os.tmpdir(), "missing-jobs.json"),
    gradesPath: path.join(t.name || os.tmpdir(), "missing-grades.json"),
    ratingsPath: path.join(t.name || os.tmpdir(), "missing-ratings.json"),
  });
  assert.equal(result.evaluations, 0);
});

test("imports a legacy WaterlooWorks database into the central FocusDesk database", (t) => {
  const sourceDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "focusdesk-ww-source-"));
  const targetDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "focusdesk-ww-target-"));
  t.after(() => {
    fs.rmSync(sourceDirectory, { recursive: true, force: true });
    fs.rmSync(targetDirectory, { recursive: true, force: true });
  });

  const source = new WaterlooWorksSqliteStore(sourceDirectory);
  source.upsertJob(job("Co-op", "99", "Legacy Developer"));
  source.upsertEvaluation("Co-op:99", { totalScore: 87 });
  source.setRating("Co-op:99", 4, "Keep in mind");
  source.close();

  const target = new WaterlooWorksSqliteStore(targetDirectory);
  assert.equal(path.basename(target.databasePath), "focusdesk.sqlite3");
  assert.deepEqual(target.importDatabase(path.join(sourceDirectory, "focusdesk.sqlite3")), {
    jobs: 1,
    evaluations: 1,
    ratings: 1,
  });
  assert.deepEqual(target.stats(), { jobs: 1, evaluations: 1, ratings: 1, scored: 1 });
  assert.match(target.getMetadata("waterlooworks_legacy_database_migrated"), /Legacy Developer|migratedAt/);
  target.close();
});
