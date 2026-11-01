import { h } from '../dom.js';
import { parseReceipt } from '../parse.js';
import { emptyReceipt, newItem, receiptFromParse } from '../state.js';
import { preloadOcr } from '../ocr.js';
import { startPhoto } from './crop.js';

// Desktop drag-and-drop. Listeners live on the window (installed once) so a drop anywhere on the page
// works; the current capture screen registers what to do with the file.
let handleFile = null;
let depth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
const onCapture = () => document.body.dataset.screen === 'capture';
const setDragging = (on) => document.body.classList.toggle('dragging', on);

window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e) || !onCapture()) return;
  depth++;
  setDragging(true);
});
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  depth = Math.max(0, depth - 1);
  if (!depth) setDragging(false);
});
window.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault(); // never let the browser navigate away to the dropped file
  e.dataTransfer.dropEffect = onCapture() ? 'copy' : 'none';
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  depth = 0;
  setDragging(false);
  const files = [...e.dataTransfer.files];
  if (onCapture() && handleFile && files.length) handleFile(files.find((f) => f.type.startsWith('image/') || /\.hei[cf]$/i.test(f.name)) ?? files.find((f) => !f.type) ?? files[0]);
});

export function render(ctx) {
  // Warm up the OCR engine (local files only) while the user lines up the photo.
  setTimeout(() => preloadOcr().catch(() => {}), 300);
  const error = h('p', { class: 'error', role: 'alert', hidden: !ctx.flash }, ctx.flash ?? '');
  ctx.flash = null;
  const busy = h('p', { class: 'muted', role: 'status', hidden: true, 'data-testid': 'photo-busy' }, 'Opening photo…');
  const showError = (msg) => {
    error.textContent = msg;
    error.hidden = false;
  };

  const pasteArea = h('textarea', {
    'data-testid': 'paste-text',
    placeholder: 'Paste the receipt text here.\n\nOn iPhone: open the photo, press and hold the text (Live Text), Select All, Copy.\nOn Android: Google Lens → Text → Copy.',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
  });
  const pastePanel = h('div', { class: 'stack', hidden: true },
    pasteArea,
    h('button', {
      class: 'btn primary block', type: 'button', 'data-testid': 'paste-go',
      onclick: () => {
        const text = pasteArea.value;
        if (!text.trim()) return showError('Paste some receipt text first.');
        ctx.state.receipt = receiptFromParse(parseReceipt(text));
        ctx.go('items');
      },
    }, 'Read this text'),
  );

  const openPhoto = async (file) => {
    // Files dragged out of Messages or Photos sometimes arrive with no type at all, so let those through.
    if (file.type && !file.type.startsWith('image/') && !/\.hei[cf]$/i.test(file.name)) {
      showError("That isn't an image. Drop a photo of the receipt, or paste its text.");
      return;
    }
    error.hidden = true;
    busy.hidden = true;
    const timer = setTimeout(() => { busy.hidden = false; }, 150);
    try {
      await startPhoto(ctx, file, { onStatus: (msg) => { busy.textContent = msg; } });
    } catch (err) {
      showError(err.message || "Couldn't open that photo. Try pasting the receipt text instead.");
      pastePanel.hidden = false;
    } finally {
      clearTimeout(timer);
      busy.hidden = true;
    }
  };
  handleFile = (file) => {
    if (ctx.state.screen === 'capture') openPhoto(file);
  };

  const fileInput = h('input', {
    type: 'file', accept: 'image/*', 'data-testid': 'photo-input', 'aria-label': 'Photo of receipt',
    onchange: (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) openPhoto(file);
    },
  });

  return h('section', { class: 'stack' },
    h('h2', null, 'Split a receipt'),
    h('p', { class: 'lead' }, 'Take a photo, say who had what, and get a split you can screenshot.'),
    error,
    busy,
    h('label', { class: 'btn primary big block file-btn', 'data-testid': 'photo-drop' },
      h('span', { class: 'file-label' }, '📷 Photo of receipt', h('span', { class: 'drop-hint' }, 'or drop it here')),
      fileInput),
    h('button', {
      class: 'btn big block', type: 'button', 'data-testid': 'paste-open',
      onclick: () => {
        pastePanel.hidden = !pastePanel.hidden;
        if (!pastePanel.hidden) pasteArea.focus();
      },
    }, 'Paste receipt text'),
    pastePanel,
    h('button', {
      class: 'btn link', type: 'button', 'data-testid': 'manual',
      onclick: () => {
        ctx.state.receipt = { ...emptyReceipt(), items: [newItem()] };
        ctx.go('items');
      },
    }, 'Enter items manually'),
  );
}
