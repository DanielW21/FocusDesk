#!/usr/bin/env node
const { parseServiceOptions } = require("./service");
const { WaterlooWorksSqliteStore } = require("./sqlite-store");
const { RunManager } = require("./run-manager");
const { boardSchema } = require("./boards");

async function main() {
  const [type, ...args] = process.argv.slice(2);
  if (!["scrape", "grade"].includes(type)) throw new Error("Usage: cli.js scrape|grade [--board=coop] [--all] [--job-key=Co-op:123] [--database=PATH] [--config-dir=PATH]");
  const serviceOptions = parseServiceOptions(args);
  const options = { board: boardSchema.parse(args.find(arg => arg.startsWith("--board="))?.slice(8) || "Co-op"),
    all: args.includes("--all"), jobKey: args.find(arg => arg.startsWith("--job-key="))?.slice(10) };
  const store = new WaterlooWorksSqliteStore(serviceOptions.dataDirectory, serviceOptions.databasePath);
  const manager = new RunManager(store, serviceOptions);
  const stop = () => { void manager.stop(); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const run = manager.start(type, options);
    process.stdout.write(`${JSON.stringify({ run })}\n`);
    await manager.active.promise;
    const completed = store.getRun(run.id);
    process.stdout.write(`${JSON.stringify({ run: completed })}\n`);
    if (completed.status !== "completed") process.exitCode = 1;
  } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); await manager.stop(); store.close(); }
}
main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
