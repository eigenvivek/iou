import { h } from '../dom.js';
import { decodeImage, guessCrop } from '../image.js';
import { preloadOcr } from '../ocr.js';

const DISPLAY_MAX = 1200;
const MIN_FRACTION = 0.05;

export async function startPhoto(ctx, file, { onStatus } = {}) {
  const bitmap = await decodeImage(file, { onStatus });
  preloadOcr().catch(() => {});
  ctx.state.image = bitmap;
  ctx.state.crop = guessCrop(bitmap);
  ctx.go('crop');
}

export function render(ctx) {
  const { image } = ctx.state;
  if (!image) {
    queueMicrotask(() => ctx.go('capture', { replace: true }));
    return h('section');
  }
  const W = image.width;
  const H = image.height;
  const crop = { ...ctx.state.crop };

  const s = Math.min(1, DISPLAY_MAX / Math.max(W, H));
  const canvas = h('canvas', { width: Math.round(W * s), height: Math.round(H * s), 'aria-hidden': 'true' });
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);

  const handles = ['tl', 'tr', 'bl', 'br'].map((c) => h('div', { class: `handle ${c}`, 'data-handle': c, 'data-testid': `crop-${c}` }));
  const box = h('div', { class: 'crop-box', 'data-handle': 'move', 'data-testid': 'crop-box' }, handles);
  const wrap = h('div', { class: 'crop-wrap' }, canvas, box);
  // Keep tall photos from pushing the buttons off screen.
  wrap.style.maxWidth = `min(100%, calc((100dvh - 260px) * ${W / H}))`;

  const place = () => {
    box.style.left = `${(crop.x / W) * 100}%`;
    box.style.top = `${(crop.y / H) * 100}%`;
    box.style.width = `${(crop.w / W) * 100}%`;
    box.style.height = `${(crop.h / H) * 100}%`;
    box.dataset.crop = [crop.x, crop.y, crop.w, crop.h].map(Math.round).join(',');
  };
  place();

  let drag = null;
  wrap.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-handle]')?.dataset.handle;
    if (!handle) return;
    e.preventDefault();
    wrap.setPointerCapture(e.pointerId);
    const rect = wrap.getBoundingClientRect();
    drag = { handle, x: e.clientX, y: e.clientY, start: { ...crop }, kx: W / rect.width, ky: H / rect.height };
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.x) * drag.kx;
    const dy = (e.clientY - drag.y) * drag.ky;
    const st = drag.start;
    const minW = W * MIN_FRACTION;
    const minH = H * MIN_FRACTION;
    let x0 = st.x;
    let y0 = st.y;
    let x1 = st.x + st.w;
    let y1 = st.y + st.h;
    if (drag.handle === 'move') {
      const mx = Math.max(-x0, Math.min(W - x1, dx));
      const my = Math.max(-y0, Math.min(H - y1, dy));
      x0 += mx; x1 += mx; y0 += my; y1 += my;
    } else {
      if (drag.handle.includes('l')) x0 = Math.max(0, Math.min(x1 - minW, x0 + dx));
      if (drag.handle.includes('r')) x1 = Math.min(W, Math.max(x0 + minW, x1 + dx));
      if (drag.handle.includes('t')) y0 = Math.max(0, Math.min(y1 - minH, y0 + dy));
      if (drag.handle.includes('b')) y1 = Math.min(H, Math.max(y0 + minH, y1 + dy));
    }
    Object.assign(crop, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    place();
  });
  const end = () => {
    drag = null;
  };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);

  const read = (c) => {
    ctx.state.crop = { x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.w), h: Math.round(c.h) };
    ctx.go('read', { replace: true });
  };

  return h('section', { class: 'stack' },
    h('h2', null, 'Crop to the receipt'),
    h('p', { class: 'lead' }, ctx.state.crop.found === false
      ? "Couldn't find the receipt edges. Drag the corners around it."
      : 'Drag the corners so only the receipt is inside. Tight crops read best.'),
    wrap,
    h('div', { class: 'row' },
      h('button', { class: 'btn grow', type: 'button', 'data-testid': 'crop-full', onclick: () => read({ x: 0, y: 0, w: W, h: H }) }, 'Use whole photo'),
      h('button', { class: 'btn primary grow', type: 'button', 'data-testid': 'crop-accept', onclick: () => read(crop) }, 'Read receipt'),
    ),
  );
}
