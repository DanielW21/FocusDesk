#!/usr/bin/env node
const { createWaterlooWorksService, parseServiceOptions } = require("./service");

async function main() {
  const options = parseServiceOptions(process.argv.slice(2), process.env);
  const service = createWaterlooWorksService(options);
  const address = await service.start();
  process.stdout.write(`${JSON.stringify({
    ready: true,
    service: "waterlooworks",
    apiVersion: "v1",
    host: address.host,
    port: address.port,
    url: `http://${address.host}:${address.port}`,
    token: options.generatedToken ? options.token : undefined,
  })}\n`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await service.stop();
  };
  process.once("SIGINT", () => stop().then(() => process.exit(0)));
  process.once("SIGTERM", () => stop().then(() => process.exit(0)));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
