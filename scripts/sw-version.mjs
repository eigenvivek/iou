// Computes the service-worker cache version from the contents of every precached file.
// `node scripts/sw-version.mjs` rewrites VERSION in sw.js; `--check` exits non-zero if it's stale.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const swUrl = new URL('sw.js', root);

export function precacheList(sw = readFileSync(swUrl, 'utf8')) {
  const block = /const FILES = \[([\s\S]*?)\];/.exec(sw)[1];
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

export function computeVersion(sw = readFileSync(swUrl, 'utf8')) {
  const hash = createHash('sha256');
  for (const file of precacheList(sw)) {
    if (file === './') continue;
    hash.update(file).update('\0').update(readFileSync(new URL(file, root))).update('\0');
  }
  return `iou-${hash.digest('hex').slice(0, 10)}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sw = readFileSync(swUrl, 'utf8');
  const version = computeVersion(sw);
  const current = /const VERSION = '([^']+)'/.exec(sw)[1];
  if (process.argv.includes('--check')) {
    if (current !== version) {
      console.error(`sw.js VERSION is ${current} but files hash to ${version}. Run: npm run sw`);
      process.exit(1);
    }
  } else {
    writeFileSync(swUrl, sw.replace(/const VERSION = '[^']+'/, `const VERSION = '${version}'`));
    console.log(`sw.js VERSION = ${version}`);
  }
}
