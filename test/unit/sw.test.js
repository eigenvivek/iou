import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { precacheList, computeVersion } from '../../scripts/sw-version.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const walk = (dir) => readdirSync(join(root, dir)).flatMap((f) => {
  const p = join(dir, f);
  return statSync(join(root, p)).isDirectory() ? walk(p) : [p];
});

test('service worker precaches every app file', () => {
  const listed = new Set(precacheList());
  const appFiles = [
    'index.html', 'app.css', 'manifest.webmanifest',
    ...walk('src'), ...walk('icons'),
    ...walk('vendor/tesseract').filter((f) => /\.(js|wasm|gz)$/.test(f)),
  ].map((f) => relative('.', f));
  const missing = appFiles.filter((f) => !listed.has(f));
  assert.deepEqual(missing, [], 'add these to FILES in sw.js');
  for (const f of listed) if (f !== './') assert.ok(statSync(join(root, f)).isFile(), `${f} is listed but missing`);
});

test('service worker cache version matches file contents (run `npm run sw` after changing app files)', () => {
  const current = /const VERSION = '([^']+)'/.exec(readFileSync(join(root, 'sw.js'), 'utf8'))[1];
  assert.equal(current, computeVersion());
});
