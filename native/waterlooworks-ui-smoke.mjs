// Browser integration test: all native calls are mocked; never scrapes or calls an LLM.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "vite";
const require = createRequire(new URL("../tools/waterlooworks/package.json", import.meta.url));
const puppeteer = require("puppeteer-core");
if (!process.env.PUPPETEER_EXECUTABLE_PATH) throw new Error("Set PUPPETEER_EXECUTABLE_PATH to an installed Chrome/Chromium executable.");
const server = await createServer({ server: { host: "127.0.0.1", port: 4173, strictPort: true }, logLevel: "error" });
await server.listen();
let browser;
const calls = [];
const jobs = Array.from({ length: 6 }, (_, index) => ({
  board: "Co-op",
  job: { id: String(index + 1), jobTitle: `Software developer ${index + 1}`, company: { name: "Example Company" }, location: { city: "Toronto" }, dates: { deadlineAt: "2026-10-01T12:00:00.000Z" }, descriptions: [{ title: "Responsibilities", content: '<p>Build useful tools.</p><img src=x onerror="window.unsafe=true"><script>window.unsafe=true</script>' }] },
  grade: { totalScore: 80 - index, relevantCandidate: true, categoryScores: { technical: 8 }, summary: { recommendation: "strong-fit" } },
  firstSeenAt: "2026-09-07T12:00:00.000Z", lastSeenAt: "2026-09-07T12:00:00.000Z",
}));
let runs = [];
let failRating = false;
try {
  browser = await puppeteer.launch({ headless: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1050 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.exposeFunction("smokeInvoke", async (action, payload = {}) => {
    if (action === "focusdesk.workspace.load") return {};
    if (action === "focusdesk.workspace.save") return { saved: true };
    if (action === "focusdesk.tasks.bootstrap") return { tasks: payload.tasks };
    if (action === "focusdesk.tasks.list") return { tasks: [] };
    if (action !== "waterlooworks.request") throw new Error("Not configured in smoke test");
    calls.push(payload);
    const { method, path, body } = payload;
    if (path.startsWith("/api/v1/jobs?")) return { jobs, page: { total: jobs.length, nextCursor: null } };
    if (path.startsWith("/api/v1/summary")) return { newJobs: jobs.filter((job) => job.rating == null).length, totalJobs: jobs.length };
    if (path === "/api/v1/capabilities") return { scrape: { available: true }, grade: { available: true } };
    if (path === "/api/v1/runs") return { runs };
    if (method === "PUT" && path.endsWith("/rating")) {
      if (failRating) throw new Error("Simulated database write failure");
      const key = decodeURIComponent(path.split("/")[4]);
      const entry = jobs.find((job) => `Co-op:${job.job.id}` === key);
      assert.ok(entry);
      entry.rating = body.rating;
      return { rating: { jobKey: key, rating: body.rating } };
    }
    if (path === "/api/v1/scrapes" || path === "/api/v1/grades") {
      const run = { id: `run-${runs.length + 1}`, type: path.endsWith("scrapes") ? "scrape" : "grade", status: "running", createdAt: new Date().toISOString() };
      runs = [run, ...runs];
      return { run };
    }
    if (path.endsWith("/cancel")) {
      const run = runs.find((run) => path.includes(run.id));
      run.status = "cancelled";
      return { run };
    }
    throw new Error(`Unexpected native route ${method} ${path}`);
  });
  await page.evaluateOnNewDocument(() => {
    window.focusDesk = { invoke: (action, payload) => window.smokeInvoke(action, payload), openLink() {} };
  });
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForSelector('[data-view="waterlooworks"]');
  await page.waitForFunction(() => document.querySelector('.widget-jobs')?.textContent.includes("6"));
  assert.equal(calls.filter((call) => call.method === "POST").length, 0, "Opening app must not start scraper or grader");
  await page.click('[data-view="waterlooworks"]');
  await page.waitForFunction(() => document.querySelector('#view-root')?.textContent.includes("Software developer"));
  assert.equal(await page.evaluate(() => !!window.unsafe), false);
  await page.keyboard.press("5");
  await page.waitForFunction(() => document.querySelector('#view-root')?.textContent.includes("Software developer 2"));
  assert.equal(jobs[0].rating, 5, "Keyboard rating must persist");
  failRating = true;
  await page.keyboard.press("4");
  await page.waitForFunction(() => document.querySelector('#view-root')?.textContent.includes("Simulated database write failure"));
  assert.equal(jobs[1].rating, undefined, "Failed rating must not be applied");
  failRating = false;
  await page.click('[data-view="today"]');
  await page.waitForFunction(() => document.querySelector('.widget-jobs')?.textContent.includes("5"));
  assert.deepEqual(errors, []);
  console.log("WaterlooWorks UI smoke passed: startup, widget, page navigation, sanitized content, persisted rank, failed save, updated count.");
} finally {
  await browser?.close();
  await server.close();
}
