const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { findPuppeteerExecutable, puppeteerCacheDirectory } = require("../src/config");

test("finds Chrome for Testing in Puppeteer's cache", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "focusdesk-puppeteer-cache-"));
  const executable = path.join(directory, "chrome", "mac_arm-152.0.0", "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing");
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, "#!/bin/sh\n");
  fs.chmodSync(executable, 0o755);

  try {
    assert.equal(findPuppeteerExecutable(path.join(directory, "chrome")), executable);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("honours Puppeteer's configured cache directory", () => {
  assert.equal(puppeteerCacheDirectory({ PUPPETEER_CACHE_DIR: "/tmp/custom-puppeteer" }), "/tmp/custom-puppeteer");
});
