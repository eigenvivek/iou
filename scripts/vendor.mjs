// Copies pinned runtime files from node_modules into vendor/ (tesseract.js for OCR, libheif for HEIC photos).
// Re-runnable. Versions come from package.json (exact pins) and are written to vendor/*/VERSIONS.json.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = (...p) => join(root, 'node_modules', ...p);
const out = join(root, 'vendor', 'tesseract');
mkdirSync(out, { recursive: true });

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = (name) => JSON.parse(readFileSync(nm(name, 'package.json'), 'utf8')).version;
const want = ['tesseract.js', 'tesseract.js-core', '@tesseract.js-data/eng', 'libheif-js'];
for (const name of want) {
  if (pkg.devDependencies[name] !== version(name)) {
    throw new Error(`${name}: installed ${version(name)} but package.json pins ${pkg.devDependencies[name]}. Run npm ci.`);
  }
}

const files = [
  [nm('tesseract.js', 'dist', 'tesseract.esm.min.js'), 'tesseract.esm.min.js'],
  [nm('tesseract.js', 'dist', 'worker.min.js'), 'worker.min.js'],
  // LSTM-only cores (we only use OEM 1). The .js loader fetches the .wasm next to the worker script.
  [nm('tesseract.js-core', 'tesseract-core-simd-lstm.js'), 'tesseract-core-simd-lstm.js'],
  [nm('tesseract.js-core', 'tesseract-core-simd-lstm.wasm'), 'tesseract-core-simd-lstm.wasm'],
  [nm('tesseract.js-core', 'tesseract-core-lstm.js'), 'tesseract-core-lstm.js'],
  [nm('tesseract.js-core', 'tesseract-core-lstm.wasm'), 'tesseract-core-lstm.wasm'],
  [nm('@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz'), 'eng.traineddata.gz'],
  [nm('tesseract.js', 'LICENSE.md'), 'LICENSE-tesseract.js.md'],
  [nm('tesseract.js-core', 'LICENSE'), 'LICENSE-tesseract.js-core'],
];

// HEIC decoder, loaded only when the browser can't open a HEIC photo itself.
const heicOut = join(root, 'vendor', 'libheif');
mkdirSync(heicOut, { recursive: true });
const heicFiles = [
  [nm('libheif-js', 'libheif-wasm', 'libheif.js'), 'libheif.js'],
  [nm('libheif-js', 'libheif-wasm', 'libheif.wasm'), 'libheif.wasm'],
  [nm('libheif-js', 'LICENSE'), 'LICENSE-libheif-js'],
  [nm('libheif-js', 'libheif-wasm', 'LICENSE'), 'LICENSE-libheif'],
];
writeFileSync(join(heicOut, 'VERSIONS.json'), JSON.stringify({ 'libheif-js': version('libheif-js') }, null, 2) + '\n');

let total = 0;
for (const [src, dest] of [...files, ...heicFiles.map(([s, d]) => [s, join('..', 'libheif', d)])]) {
  copyFileSync(src, join(out, dest));
  const size = statSync(src).size;
  total += size;
  console.log(`${dest.padEnd(32)} ${(size / 1024).toFixed(0).padStart(6)} KB`);
}
writeFileSync(join(out, 'VERSIONS.json'), JSON.stringify(Object.fromEntries(
  [...want.filter((n) => n !== 'libheif-js').map((n) => [n, version(n)]), ['traineddata', 'eng 4.0.0_best_int']]), null, 2) + '\n');
console.log(`total ${(total / 1024 / 1024).toFixed(2)} MB`);
