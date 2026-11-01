// Renders icons/icon.svg to the PNG sizes the manifest and iOS need. Re-runnable.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('../icons/', import.meta.url);
const svg = await loadImage(readFileSync(new URL('icon.svg', dir)));

for (const size of [180, 192, 512]) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  if (size === 180) {
    // iOS rounds the corners itself; transparent corners would render black.
    ctx.fillStyle = '#0f766e';
    ctx.fillRect(0, 0, size, size);
  }
  ctx.drawImage(svg, 0, 0, size, size);
  writeFileSync(new URL(`icon-${size}.png`, dir), c.toBuffer('image/png'));
}

// Maskable: full-bleed background, glyph inside the 80% safe zone.
const size = 512;
const c = createCanvas(size, size);
const ctx = c.getContext('2d');
ctx.fillStyle = '#0f766e';
ctx.fillRect(0, 0, size, size);
const inner = size * 0.8;
ctx.drawImage(svg, (size - inner) / 2, (size - inner) / 2, inner, inner);
writeFileSync(new URL('icon-maskable-512.png', dir), c.toBuffer('image/png'));
console.log('icons written');
