const path = require("node:path");
const { build } = require("esbuild");

build({
  absWorkingDir: __dirname,
  entryPoints: { server: "src/server.js", cli: "src/cli.js", "migrate-legacy": "src/migrate-legacy.js" },
  outdir: "dist", bundle: true, platform: "node", target: "node22.5", format: "cjs",
  alias: { src: path.join(__dirname, "scraper/src") },
  tsconfigRaw: { compilerOptions: { strict: true, esModuleInterop: true } },
  // Puppeteer embeds functions as strings for execution inside the browser.
  minify: false,
}).catch(() => { process.exitCode = 1; });
