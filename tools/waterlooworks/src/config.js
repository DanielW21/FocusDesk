const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { z } = require("zod");

const hash = value => crypto.createHash("sha256").update(value).digest("hex");
function configurationError(message) {
  return Object.assign(new Error(message), { code: "CONFIGURATION_UNAVAILABLE", status: 503 });
}
function configDirectory(options = {}) {
  return path.resolve(options.configDirectory || path.join(options.dataDirectory ||
    path.join(os.homedir(), "Library/Application Support/FocusDesk"), "waterlooworks/config"));
}
function localEnvironment(directory, env = process.env) {
  const values = {};
  const file = path.join(directory, ".env.local");
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
  return { ...values, ...env };
}
function loadGradeConfig(options = {}) {
  const directory = configDirectory(options);
  const env = localEnvironment(directory, options.env);
  if (!env.DEEPSEEK_API_KEY) throw configurationError(`Set DEEPSEEK_API_KEY in ${directory}/.env.local or the process environment.`);
  const files = ["profile.json", "candidate-context.md", "category-guidance.md", "instructions.md", "schema.json"];
  const content = files.map(name => {
    try {
      const value = fs.readFileSync(path.join(directory, name), "utf8");
      if (!value.trim()) throw new Error();
      return value;
    } catch { throw configurationError(`Missing or unreadable grading configuration: ${path.join(directory, name)}`); }
  });
  try {
    z.record(z.string(), z.unknown()).parse(JSON.parse(content[0]));
    z.record(z.string(), z.unknown()).parse(JSON.parse(content[4]));
  } catch { throw configurationError("profile.json and schema.json must contain valid JSON objects."); }
  const [profile, context, guidance, instructions, schema] = content;
  const endpoint = env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/chat/completions";
  try { if (new URL(endpoint).protocol !== "https:") throw new Error(); }
  catch { throw configurationError("DEEPSEEK_BASE_URL must be an HTTPS URL."); }
  const model = env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  return { apiKey: env.DEEPSEEK_API_KEY, endpoint, provider: "deepseek", model,
    // Keep legacy prompt hash byte-for-byte compatible with llm-pass.
    promptHash: hash(content.join("\n---\n")), modelHash: hash(`deepseek\n${model}\n${endpoint}`),
    system: `${instructions}\n\nCANDIDATE CONTEXT:\n${context}\n\nCUSTOM CATEGORY GUIDANCE:\n${guidance}\n\nCANDIDATE PROFILE JSON:\n${profile}\n\nOUTPUT JSON SCHEMA:\n${schema}` };
}
function loadScrapeConfig(options = {}) {
  const directory = configDirectory(options);
  const env = localEnvironment(directory, options.env);
  const candidates = [env.PUPPETEER_EXECUTABLE_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    path.join(os.homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium"];
  const executablePath = candidates.find(candidate => {
    if (!candidate) return false;
    try { fs.accessSync(candidate, fs.constants.X_OK); return fs.statSync(candidate).isFile(); } catch { return false; }
  });
  if (!executablePath) throw configurationError(`Chrome unavailable. Set PUPPETEER_EXECUTABLE_PATH in ${directory}/.env.local.`);
  return { directory, executablePath };
}
function availability(loader) {
  try { loader(); return { available: true }; }
  catch (error) { return { available: false, code: "CONFIGURATION_UNAVAILABLE", reason: error.code === "CONFIGURATION_UNAVAILABLE" ? error.message : "Local configuration could not be read." }; }
}
module.exports = { hash, configDirectory, configurationError, loadGradeConfig, loadScrapeConfig, availability };
