const crypto = require("node:crypto");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { WaterlooWorksSqliteStore } = require("./sqlite-store");
const { z } = require("zod");
const { boardSchema } = require("./boards");
const { RunManager } = require("./run-manager");

const HOST = "127.0.0.1";
const MAX_BODY_BYTES = 64 * 1024;

function parseServiceOptions(args, env = process.env) {
  const readArg = (name) =>
    args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const rawPort = readArg("port") || env.WW_SERVICE_PORT || "0";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("Port must be an integer from 0 to 65535");
  }
  const suppliedToken = readArg("token") || env.WW_SERVICE_TOKEN;
  const dataDirectory = path.resolve(
    readArg("data-dir") ||
      env.WW_DATA_DIR ||
      path.join(os.homedir(), "Library/Application Support/FocusDesk"),
  );
  const databasePath = path.resolve(
    readArg("database") ||
      env.WW_DATABASE_PATH ||
      path.join(dataDirectory, "focusdesk.sqlite3"),
  );
  return {
    host: HOST,
    port,
    token: suppliedToken || crypto.randomBytes(32).toString("base64url"),
    generatedToken: !suppliedToken,
    dataDirectory,
    databasePath,
    configDirectory: path.resolve(readArg("config-dir") || env.WW_CONFIG_DIR || path.join(dataDirectory, "waterlooworks/config")),
  };
}

function sendJson(res, status, value, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(value));
}

function sendError(res, status, code, message, recoverable = false) {
  sendJson(res, status, { error: { code, message, recoverable } });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const error = new Error("Request body is too large");
        error.code = "BODY_TOO_LARGE";
        reject(error);
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.once("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        const error = new Error("Request body must be valid JSON");
        error.code = "INVALID_JSON";
        reject(error);
      }
    });
    req.once("error", reject);
  });
}

function bearerToken(req) {
  return req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
}

function tokenMatches(actual, expected) {
  if (!actual) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

const scrapeRequest = z.object({ board: boardSchema.default("Co-op") }).strict();
const gradeRequest = scrapeRequest.extend({ all: z.boolean().optional(), jobKey: z.string().min(1).optional() });
const jobsQuery = z.object({ q: z.string().default(""), board: boardSchema.default("Co-op"),
  limit: z.coerce.number().int().min(1).max(10000).default(50), cursor: z.coerce.number().int().min(0).default(0),
  minimumScore: z.coerce.number().min(0).max(100).default(0),
  rating: z.union([z.literal("unranked"), z.coerce.number().int().min(1).max(5)]).optional() });
const ratingRequest = z.object({ rating: z.number().int().min(1).max(5).nullable(), note: z.string().max(10000).optional() }).strict();

function createWaterlooWorksService(options, dependencies = {}) {
  options = { ...options, host: HOST };
  const store = new WaterlooWorksSqliteStore(options.dataDirectory, options.databasePath);
  const manager = new RunManager(store, options, dependencies);
  let server;

  const handler = async (req, res) => {
    try {
      const address = server.address();
      const origin = `http://${options.host}:${address?.port || options.port}`;
      const url = new URL(req.url || "/", origin);
      if (req.headers.origin && req.headers.origin !== origin) {
        return sendError(res, 403, "ORIGIN_REJECTED", "Cross-origin requests are not permitted");
      }
      if (!tokenMatches(bearerToken(req), options.token)) {
        return sendError(res, 401, "UNAUTHORIZED", "A valid service token is required");
      }
      if (["POST", "PUT", "PATCH"].includes(req.method) &&
          !String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
        return sendError(res, 415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json");
      }

      if (url.pathname === "/api/v1/health" && req.method === "GET") {
        return sendJson(res, 200, { service: "waterlooworks", apiVersion: "v1", status: "ok" });
      }
      if (url.pathname === "/api/v1/capabilities" && req.method === "GET") {
        return sendJson(res, 200, {
          storage: { available: true, databasePath: store.databasePath, schemaVersion: store.getMetadata("waterlooworks_schema_version") },
          jobs: { available: true },
          ratings: { available: true },
          ...manager.capabilities(),
        });
      }
      if (url.pathname === "/api/v1/jobs" && req.method === "GET") {
        const query = jobsQuery.parse(Object.fromEntries(url.searchParams));
        const { limit, cursor: offset } = query;
        const result = store.listJobs({
          ...query,
          limit,
          offset,
        });
        return sendJson(res, 200, {
          jobs: result.jobs,
          page: { total: result.total, limit, nextCursor: offset + limit < result.total ? String(offset + limit) : null },
        });
      }
      const jobMatch = url.pathname.match(/^\/api\/v1\/jobs\/([^/]+)$/);
      if (jobMatch && req.method === "GET") {
        const job = store.getJob(decodeURIComponent(jobMatch[1]));
        return job
          ? sendJson(res, 200, { job })
          : sendError(res, 404, "JOB_NOT_FOUND", "Job was not found");
      }
      const ratingMatch = url.pathname.match(/^\/api\/v1\/jobs\/([^/]+)\/rating$/);
      if (ratingMatch && req.method === "PUT") {
        const body = ratingRequest.parse(await readBody(req));
        const result = store.setRating(decodeURIComponent(ratingMatch[1]), body.rating, body.note);
        return result
          ? sendJson(res, 200, { rating: result })
          : sendError(res, 404, "JOB_NOT_FOUND", "Job was not found");
      }
      if (url.pathname === "/api/v1/ratings" && req.method === "GET") {
        return sendJson(res, 200, store.listRatings(boardSchema.parse(url.searchParams.get("board") || "all")));
      }
      if (url.pathname === "/api/v1/summary" && req.method === "GET") {
        return sendJson(res, 200, store.summary(boardSchema.parse(url.searchParams.get("board") || "Co-op")));
      }
      if ((url.pathname === "/api/v1/scrapes" || url.pathname === "/api/v1/grades") && req.method === "POST") {
        const type = url.pathname.endsWith("scrapes") ? "scrape" : "grade";
        const body = (type === "scrape" ? scrapeRequest : gradeRequest).parse(await readBody(req));
        return sendJson(res, 202, { run: manager.start(type, body) });
      }
      if (url.pathname === "/api/v1/runs" && req.method === "GET") {
        const query = z.object({ board: boardSchema.optional(), limit: z.coerce.number().int().min(1).max(1000).default(50) })
          .parse(Object.fromEntries(url.searchParams));
        return sendJson(res, 200, { runs: store.listRuns(query) });
      }
      const runMatch = url.pathname.match(/^\/api\/v1\/runs\/([^/]+)(\/cancel)?$/);
      if (runMatch && req.method === "POST" && runMatch[2]) {
        z.object({}).strict().parse(await readBody(req));
        return sendJson(res, 200, { run: manager.cancel(decodeURIComponent(runMatch[1])) });
      }
      if (runMatch && req.method === "GET" && !runMatch[2]) {
        const run = store.getRun(decodeURIComponent(runMatch[1]));
        return run ? sendJson(res, 200, { run }) : sendError(res, 404, "RUN_NOT_FOUND", "Run was not found");
      }
      return sendError(res, 404, "NOT_FOUND", "Route was not found");
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof URIError) return sendError(res, 400, "INVALID_REQUEST", "Invalid request fields");
      if (error.status && error.code) return sendError(res, error.status, error.code, error.message, true);
      if (error.code === "BODY_TOO_LARGE") return sendError(res, 413, error.code, error.message);
      if (error.code === "INVALID_JSON") return sendError(res, 400, error.code, error.message);
      if (error.message?.startsWith("rating must be")) return sendError(res, 400, "INVALID_RATING", error.message);
      return sendError(res, 500, "INTERNAL_ERROR", "The request could not be completed");
    }
  };

  return {
    async start() {
      server = http.createServer(handler);
      server.requestTimeout = 30_000;
      server.headersTimeout = 10_000;
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port, options.host, resolve);
      });
      const address = server.address();
      return { host: options.host, port: address.port };
    },
    async stop() {
      const closed = server?.listening ? new Promise((resolve) => server.close(resolve)) : Promise.resolve();
      await manager.stop();
      await closed;
      store.close();
    },
    store,
    manager,
  };
}

module.exports = { createWaterlooWorksService, parseServiceOptions };
