// Build step: writes .br and .gz next to every text asset in dist/assets so the server can send
// compressed bundles straight from disk (no compression work per request under heavy traffic).
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

const dir = join(process.cwd(), 'dist', 'assets');
const EXT = new Set(['.js', '.css', '.svg', '.json']);
let count = 0;
let saved = 0;
for (const name of readdirSync(dir)) {
  const file = join(dir, name);
  if (!EXT.has(extname(name)) || statSync(file).size < 1024) continue;
  const raw = readFileSync(file);
  const br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
  const gz = gzipSync(raw, { level: 9 });
  writeFileSync(file + '.br', br);
  writeFileSync(file + '.gz', gz);
  count++;
  saved += raw.length - br.length;
}
console.log(`precompress: ${count} assets, ${(saved / 1024).toFixed(0)} kB smaller with brotli`);
