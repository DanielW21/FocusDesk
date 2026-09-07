const { gradeJobs } = require("./grader");
const { scrapeJobs } = require("./scraper");
const { availability, loadGradeConfig, loadScrapeConfig } = require("./config");
const { selectBoards } = require("./boards");

class RunManager {
  constructor(store, options = {}, dependencies = {}) {
    this.store = store;
    this.options = options;
    this.runners = { scrape: scrapeJobs, grade: gradeJobs, ...dependencies.runners };
    this.loaders = { scrape: () => loadScrapeConfig(options), grade: () => loadGradeConfig(options), ...dependencies.loaders };
    this.active = null;
    this.stopping = false;
    store.interruptRuns();
  }
  capabilities() {
    return { scrape: availability(this.loaders.scrape), grade: availability(this.loaders.grade) };
  }
  start(type, options) {
    if (this.active || this.stopping) throw Object.assign(new Error("A WaterlooWorks run is already active or the service is stopping"), { status: 409, code: "RUN_ACTIVE" });
    if (options.jobKey) {
      const entry = this.store.getJob(options.jobKey);
      if (!entry || !selectBoards(options.board).includes(entry.board)) throw Object.assign(new Error("Job was not found on the selected board"), { status: 404, code: "JOB_NOT_FOUND" });
    }
    const config = this.loaders[type]();
    const run = this.store.createRun(type, options.board, options);
    const controller = new AbortController();
    const active = { id: run.id, controller, promise: null };
    this.active = active;
    active.promise = Promise.resolve().then(async () => {
      try {
        controller.signal.throwIfAborted();
        this.store.updateRun(run.id, { status: "running", message: "Running" });
        const progress = await this.runners[type]({ store: this.store, config, options, signal: controller.signal,
          report: progress => {
            if (!controller.signal.aborted) this.store.updateRun(run.id, { progress, message: progress.message || "Running" });
          } });
        controller.signal.throwIfAborted();
        this.store.updateRun(run.id, { status: "completed", message: "Completed", progress, exitCode: 0 });
      } catch (error) {
        const cancelled = controller.signal.aborted;
        this.store.updateRun(run.id, { status: cancelled ? "cancelled" : "failed",
          message: cancelled ? "Cancelled" : safeFailure(error), exitCode: cancelled ? null : 1,
          signal: cancelled ? "ABORT" : null });
      } finally { if (this.active === active) this.active = null; }
    });
    return run;
  }
  cancel(id) {
    const run = this.store.getRun(id);
    if (!run) throw Object.assign(new Error("Run was not found"), { status: 404, code: "RUN_NOT_FOUND" });
    if (this.active?.id === id) {
      this.store.updateRun(id, { status: "cancelling", message: "Cancelling" });
      this.active.controller.abort();
    }
    return this.store.getRun(id);
  }
  async stop() {
    this.stopping = true;
    if (this.active) { const active = this.active; this.cancel(active.id); await active.promise; }
  }
}
function safeFailure(error) {
  if (/^Grading provider returned (HTTP \d+|an invalid evaluation)$/.test(error.message)) return error.message;
  if (error.name === "TimeoutError") return "Operation timed out; retry explicitly.";
  return "Run failed. Check local configuration, login and connectivity before retrying.";
}
module.exports = { RunManager };
