import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = resolve(projectRoot, 'dist/index.html');
let html = readFileSync(htmlPath, 'utf8');

html = html.replace(
  /<link rel="stylesheet" crossorigin href="([^"]+)">/g,
  (_match, href) => `<style>\n${readFileSync(resolve(projectRoot, 'dist', href), 'utf8')}\n</style>`,
);

html = html.replace(
  /<script type="module" crossorigin src="([^"]+)"><\/script>/g,
  (_match, src) => `<script type="module">\n${readFileSync(resolve(projectRoot, 'dist', src), 'utf8')}\n<\/script>`,
);

writeFileSync(htmlPath, html);
