#!/usr/bin/env node
const path = require("node:path");
const { WaterlooWorksSqliteStore } = require("./sqlite-store");

function argument(name) {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const sourceRoot = path.resolve(argument("source") || path.join(__dirname, "../../../../WaterlooWorks"));
const dataDirectory = path.resolve(
  argument("data-dir") || path.join(require("node:os").homedir(), "Library/Application Support/FocusDesk"),
);
const databasePath = argument("database") ? path.resolve(argument("database")) : undefined;
const fromDatabase = argument("from-database");
const scraperData = path.join(sourceRoot, "waterlooworks-scraper", "data");
const llmData = path.join(sourceRoot, "llm-pass", "data");
const store = new WaterlooWorksSqliteStore(dataDirectory, databasePath);

try {
  const result = store.migrateLegacy({
    jobsPath: path.join(scraperData, "jobs.json"),
    gradesPath: path.join(scraperData, "graded-jobs.json"),
    ratingsPath: path.join(llmData, "ratings.json"),
  });
  const databaseResult = fromDatabase ? store.importDatabase(fromDatabase) : undefined;
  console.log(JSON.stringify({ databasePath: store.databasePath, ...result, databaseResult }, null, 2));
} finally {
  store.close();
}
