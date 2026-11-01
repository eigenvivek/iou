import { h } from '../dom.js';
import { preprocess } from '../image.js';
import { recognize } from '../ocr.js';
import { parseReceipt } from '../parse.js';
import { receiptFromParse } from '../state.js';

let job = null; // { crop, promise } so a re-render doesn't start a second OCR run

export function render(ctx) {
  const { image, crop } = ctx.state;
  if (!image || !crop) {
    queueMicrotask(() => ctx.go('capture', { replace: true }));
    return h('section');
  }

  const bar = h('div');
  const status = h('p', { class: 'muted', 'data-testid': 'read-status' }, 'Preparing the photo…');
  const error = h('div', { class: 'stack', hidden: true });
  const onProgress = (fraction, label) => {
    bar.style.width = `${Math.round(fraction * 100)}%`;
    status.textContent = label;
  };

  if (job?.crop !== crop) {
    job = {
      crop,
      promise: (async () => {
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r)));
        const canvas = preprocess(image, crop);
        return recognize(canvas, (f, l) => job?.onProgress?.(f, l));
      })(),
    };
  }
  job.onProgress = onProgress;
  const mine = job;
  mine.promise.then(
    ({ text }) => {
      if (job !== mine || ctx.state.screen !== 'read') return;
      job = null;
      ctx.state.receipt = receiptFromParse(parseReceipt(text));
      ctx.go('items', { replace: true });
    },
    (err) => {
      if (job !== mine) return;
      job = null;
      console.error(err);
      status.textContent = '';
      error.hidden = false;
      error.replaceChildren(
        h('p', { class: 'error', role: 'alert' }, "Couldn't read the photo on this device. You can paste the receipt text instead."),
        h('button', { class: 'btn primary', type: 'button', onclick: () => ctx.go('capture', { replace: true }) }, 'Back'),
      );
    },
  );

  return h('section', { class: 'stack' },
    h('h2', null, 'Reading the receipt'),
    h('p', { class: 'lead' }, 'This happens on your phone and takes a few seconds.'),
    h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Reading progress' }, bar),
    status,
    error,
  );
}
