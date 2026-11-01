import { createState, decodeSplit } from './state.js';
import * as capture from './ui/capture.js';
import * as crop from './ui/crop.js';
import * as read from './ui/read.js';
import * as items from './ui/items.js';
import * as people from './ui/people.js';
import * as assign from './ui/assign.js';
import * as results from './ui/results.js';

const screens = { capture, crop, read, items, people, assign, results };
const STEPS = { items: 'Step 1 of 4', people: 'Step 2 of 4', assign: 'Step 3 of 4', results: 'Step 4 of 4' };
const BACK = { crop: 'capture', read: 'capture', items: 'capture', people: 'items', assign: 'people', results: 'assign' };

const app = document.getElementById('app');
const backBtn = document.getElementById('back');
const step = document.getElementById('step');

const ctx = {
  state: createState(),
  flash: null, // one-shot message for the next render of the capture screen
  go(screen, { replace = false } = {}) {
    ctx.state.screen = screen;
    const url = location.pathname + location.search; // leaving a shared link's hash behind once you navigate
    if (replace) history.replaceState({ screen }, '', url);
    else history.pushState({ screen }, '', url);
    render();
    window.scrollTo(0, 0);
  },
  rerender: () => render(),
  reset() {
    ctx.state = createState();
    ctx.go('capture');
  },
};

function render() {
  const { screen } = ctx.state;
  backBtn.hidden = !BACK[screen];
  step.textContent = STEPS[screen] ?? '';
  document.body.dataset.screen = screen;
  app.replaceChildren(screens[screen].render(ctx));
}

backBtn.addEventListener('click', () => ctx.go(BACK[ctx.state.screen]));

window.addEventListener('popstate', (e) => {
  const screen = e.state?.screen;
  if (screen && screens[screen]) {
    // Don't land on transient screens with nothing to show.
    ctx.state.screen = (screen === 'crop' && !ctx.state.image) || screen === 'read' ? 'capture' : screen;
    render();
  }
});

function boot() {
  const m = /^#s=([A-Za-z0-9_-]+)$/.exec(location.hash);
  if (m) {
    try {
      ctx.state = decodeSplit(m[1]);
    } catch {
      ctx.flash = "That link couldn't be opened. It may have been cut off when it was copied.";
    }
  }
  history.replaceState({ screen: ctx.state.screen }, '', location.href);
  render();
}

boot();

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
