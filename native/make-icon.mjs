import { readFileSync, writeFileSync } from 'node:fs';

const [, , output, ...entries] = process.argv;
const chunks = [];

for (let index = 0; index < entries.length; index += 2) {
  const type = entries[index];
  const image = readFileSync(entries[index + 1]);
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, 'ascii');
  header.writeUInt32BE(image.length + 8, 4);
  chunks.push(header, image);
}

const body = Buffer.concat(chunks);
const header = Buffer.alloc(8);
header.write('icns', 0, 4, 'ascii');
header.writeUInt32BE(body.length + 8, 4);
writeFileSync(output, Buffer.concat([header, body]));
