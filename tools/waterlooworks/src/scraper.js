const fs = require("node:fs");
const { selectBoards } = require("./boards");
const { hashJob } = require("./sqlite-store");

async function scrapeJobs({ store, options, config, signal, report, adapter }) {
  // Kept lazy so reading jobs, launching the service and mock tests never launch Chrome.
  const implementation = adapter || {
    launch: launchOptions => require("puppeteer-core").launch(launchOptions),
    login: (...args) => require("../scraper/src/scraping/login/login.ts").login(...args),
    scrape: (...args) => require("../scraper/src/scraping/scrapeJobs/scrapeJobs.ts").scrapeJobs(...args),
  };
  signal.throwIfAborted();
  fs.mkdirSync(config.directory, { recursive: true, mode: 0o700 });
  const previousDirectory = process.env.WW_CONFIG_DIR;
  process.env.WW_CONFIG_DIR = config.directory;
  let browser;
  let closing;
  const close = () => { if (browser && !closing) closing = Promise.resolve(browser.close()).catch(() => {}); return closing; };
  const progress = { total: 0, completed: 0, added: 0, changed: 0 };
  const reporter = {
    nextStep(message, total) { signal.throwIfAborted(); Object.assign(progress, { message, total, completed: 0 }); report(progress); },
    reportProgress(message) { signal.throwIfAborted(); progress.completed++; if (message) progress.message = message; report(progress); },
    requestAction(message) { signal.throwIfAborted(); report({ ...progress, message }); },
  };
  signal.addEventListener("abort", close, { once: true });
  try {
    browser = await implementation.launch({ headless: false, defaultViewport: null, executablePath: config.executablePath });
    signal.throwIfAborted();
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(true);
    await implementation.login(page, reporter, true);
    for (const board of selectBoards(options.board)) {
      signal.throwIfAborted();
      const jobs = await implementation.scrape(page, reporter, board);
      signal.throwIfAborted();
      store.database.exec("BEGIN IMMEDIATE");
      try {
        for (const job of jobs) {
          const old = store.getJob(`${board}:${job.id}`);
          if (!store.upsertJob({ board, job })) throw new Error("Scraper returned a job without an ID");
          if (!old) progress.added++;
          else if (old.contentHash !== hashJob(job)) progress.changed++;
        }
        store.database.exec("COMMIT");
      } catch (error) { store.database.exec("ROLLBACK"); throw error; }
      report({ ...progress, board, message: `Saved ${jobs.length} jobs from ${board}` });
    }
    return progress;
  } finally {
    signal.removeEventListener("abort", close);
    await close();
    if (previousDirectory === undefined) delete process.env.WW_CONFIG_DIR;
    else process.env.WW_CONFIG_DIR = previousDirectory;
  }
}
module.exports = { scrapeJobs };
