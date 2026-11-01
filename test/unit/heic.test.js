import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isHeif } from '../../src/heic.js';

const ftyp = (major, ...compat) => {
  const brands = [major, '\0\0\0\0', ...compat].join('');
  const size = 8 + brands.length;
  return Uint8Array.from([0, 0, 0, size, ...'ftyp', ...brands].map((c) => (typeof c === 'number' ? c : c.charCodeAt(0))));
};

test('isHeif recognises HEIC/HEIF headers by major or compatible brand', () => {
  assert.equal(isHeif(readFileSync(new URL('../../fixtures/synthetic_receipt.heic', import.meta.url))), true);
  assert.equal(isHeif(ftyp('heic', 'mif1')), true);
  assert.equal(isHeif(ftyp('mif1', 'heic')), true);
  assert.equal(isHeif(ftyp('isom', 'heix')), true);
  assert.equal(isHeif(ftyp('isom', 'mp41')), false); // an MP4 video
  assert.equal(isHeif(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1])), false); // JPEG
  assert.equal(isHeif(new Uint8Array(4)), false);
});
