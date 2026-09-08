const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createWaterlooWorksService } = require("../src/service");
const { WaterlooWorksSqliteStore } = require("../src/sqlite-store");

function job(board, id, title) {
  return { board, job: { id, jobTitle: title, company: { name: "Example" }, url: `https://example.test/${id}` } };
}

test("uses the central FocusDesk database by default", async () => {
  const { parseServiceOptions } = require("../src/service");
  const options = parseServiceOptions(["--port=0", "--data-dir=/tmp/focusdesk-central"]);
  assert.equal(options.databasePath, "/tmp/focusdesk-central/focusdesk.sqlite3");
});

async function fixture(t, dependencies = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "focusdesk-ww-service-"));
  const store = new WaterlooWorksSqliteStore(directory);
  store.upsertJob(job("Co-op", "42", "Developer"));
  store.upsertJob(job("Direct", "43", "Analyst"));
  store.upsertEvaluation("Co-op:42", { totalScore: 92, relevantCandidate: true, evaluatedAt: "2026-01-01T00:00:00.000Z" });
  store.setRating("Co-op:42", 5);
  store.close();
  const service = createWaterlooWorksService({ host: "127.0.0.1", port: 0, token: "test-token", dataDirectory: directory }, dependencies);
  const address = await service.start();
  const base = `http://${address.host}:${address.port}`;
  const request = (route, init = {}) => fetch(`${base}${route}`, { ...init, headers: { Authorization: "Bearer test-token", ...init.headers } });
  t.after(async () => { await service.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { base, request };
}

test("serves authenticated SQLite-backed capabilities and jobs", async (t) => {
  const { request } = await fixture(t, { loaders: { scrape: () => { throw new Error("browser intentionally unavailable in this test"); } } });
  assert.equal((await request("/api/v1/health")).status, 200);
  const capabilities = await (await request("/api/v1/capabilities")).json();
  assert.equal(capabilities.storage.available, true);
  assert.equal(capabilities.scrape.available, false);
  const response = await (await request("/api/v1/jobs?q=dev&minimumScore=90")).json();
  assert.equal(response.page.total, 1);
  assert.equal(response.jobs[0].job.id, "42");
  assert.equal(response.jobs[0].rating, 5);
});

test("rejects unauthenticated and foreign-origin requests", async (t) => {
  const { base, request } = await fixture(t);
  assert.equal((await fetch(`${base}/api/v1/health`)).status, 401);
  assert.equal((await request("/api/v1/health", { headers: { Origin: "https://example.test" } })).status, 403);
});

test("validates and updates ratings through the API", async (t) => {
  const { request } = await fixture(t);
  const invalid = await request("/api/v1/jobs/Co-op%3A42/rating", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating: 6 }) });
  assert.equal(invalid.status, 400);
  const saved = await request("/api/v1/jobs/Direct%3A43/rating", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating: 4, note: "Consider" }) });
  assert.equal(saved.status, 200);
  assert.equal((await (await request("/api/v1/jobs/Direct%3A43")).json()).job.rating, 4);
});

test("records explicit runs and lets an active run be cancelled", async (t) => {
  let startedBoard;
  const { request } = await fixture(t, {
    loaders: {
      scrape: () => ({ configured: true }),
      grade: () => ({ configured: true }),
    },
    runners: {
      scrape: async ({ options, signal, report }) => {
        startedBoard = options.board;
        report({ message: "Waiting for browser", total: 1, completed: 0 });
        await new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
      grade: async () => ({ total: 0, completed: 0, graded: 0, skipped: 0 }),
    },
  });
  const headers = { "Content-Type": "application/json" };
  const capabilities = await (await request("/api/v1/capabilities")).json();
  assert.equal(capabilities.scrape.available, true);
  const started = await (await request("/api/v1/scrapes", { method: "POST", headers, body: JSON.stringify({ board: "coop" }) })).json();
  assert.equal(started.run.type, "scrape");
  assert.equal(started.run.board, "Co-op");
  assert.equal(startedBoard, "Co-op");
  const cancelled = await (await request(`/api/v1/runs/${started.run.id}/cancel`, { method: "POST", headers, body: "{}" })).json();
  assert.equal(cancelled.run.status, "cancelling");
  let current = cancelled.run;
  for (let index = 0; index < 20 && current.status !== "cancelled"; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    current = (await (await request(`/api/v1/runs/${started.run.id}`)).json()).run;
  }
  assert.equal(current.status, "cancelled");
  const runs = await (await request("/api/v1/runs?board=coop")).json();
  assert.equal(runs.runs[0].id, started.run.id);
});
