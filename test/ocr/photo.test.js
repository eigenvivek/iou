// OCR integration: a real receipt photo → image.js crop + preprocess → tesseract.js → parse.js.
// Runs only when fixtures/private/ holds a photo and an expected.json describing it. Both are gitignored,
// so personal photos and their amounts are never committed. See test/e2e/helpers.js for the JSON shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { createWorker } from 'tesseract.js';
import { guessCrop, preprocess } from '../../src/image.js';
import { OCR_PARAMS } from '../../src/ocr.js';
import { parseReceipt, reconcile } from '../../src/parse.js';

const dir = new URL('../../fixtures/private/', import.meta.url);
const photo = existsSync(dir) && readdirSync(dir).find((f) => /\.(jpe?g|png|webp)$/i.test(f));
const expectedFile = new URL('expected.json', dir);
const expected = existsSync(expectedFile) && JSON.parse(readFileSync(expectedFile, 'utf8'));
const langPath = new URL('../../vendor/tesseract/', import.meta.url).pathname;

const skip = (!photo && 'no photo in fixtures/private/') || (!expected && 'no fixtures/private/expected.json');
if (skip) {
  console.log(`# OCR integration skipped: ${skip}.`);
}

test('private receipt photo: auto-crop, OCR, parse', { skip }, async (t) => {
  const img = await loadImage(new URL(photo, dir).pathname);
  const t0 = performance.now();
  const crop = guessCrop(img, createCanvas);
  assert.ok(crop.found, 'auto-crop should find the receipt');
  // The receipt is roughly the middle third of the frame; make sure we cut most of the table away.
  assert.ok(crop.w * crop.h < img.width * img.height * 0.6, `crop too large: ${JSON.stringify(crop)}`);
  const png = preprocess(img, crop, createCanvas).toBuffer('image/png');
  const t1 = performance.now();

  const worker = await createWorker('eng', 1, { langPath, cacheMethod: 'none' });
  t.after(() => worker.terminate());
  await worker.setParameters(OCR_PARAMS);
  const t2 = performance.now();
  const { data } = await worker.recognize(png);
  const t3 = performance.now();

  t.diagnostic(`crop ${JSON.stringify(crop)} of ${img.width}x${img.height}`);
  t.diagnostic(`preprocess ${(t1 - t0).toFixed(0)} ms, OCR ${(t3 - t2).toFixed(0)} ms, mean confidence ${data.confidence}%`);
  const lines = data.lines ?? data.blocks?.flatMap((b) => b.paragraphs.flatMap((p) => p.lines)) ?? [];
  const priced = lines.filter((l) => /\d\.\d\d/.test(l.text));
  if (priced.length) {
    const confs = priced.map((l) => l.confidence);
    t.diagnostic(`priced-line confidence ${Math.min(...confs).toFixed(0)}–${Math.max(...confs).toFixed(0)}%`);
  }

  const r = parseReceipt(data.text);
  assert.deepEqual(r.items.map((i) => i.price), expected.prices, `OCR text was:\n${data.text}`);
  assert.equal(r.total, expected.total);
  assert.equal(r.subtotal, expected.subtotal);
  assert.deepEqual(r.extras.map((x) => [x.kind, x.amount]), expected.extras);
  assert.equal(r.merchant, expected.merchant);
  assert.equal(r.date, expected.date);
  assert.equal(reconcile(r).status, 'ok');
});
