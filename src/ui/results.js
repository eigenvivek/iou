import { h, toast } from '../dom.js';
import { formatCents, splitReceipt } from '../split.js';
import { encodeSplit, rememberNames, toSplitInput } from '../state.js';

const expanded = new Set();

export function shareUrl(state) {
  return `${location.origin}${location.pathname}#s=${encodeSplit(state)}`;
}

export function render(ctx) {
  const s = ctx.state;
  let result;
  try {
    result = splitReceipt(toSplitInput(s), s.people);
  } catch (err) {
    return h('section', { class: 'stack' },
      h('h2', null, "Can't split this yet"),
      h('p', { class: 'error', role: 'alert' }, err.message),
      h('button', { class: 'btn primary', type: 'button', onclick: () => ctx.go('assign') }, 'Back to assigning'),
    );
  }
  rememberNames(s.people);

  const r = s.receipt;
  const people = result.people.map((p) => {
    const isPayer = p.name === s.payer;
    const open = expanded.has(p.name);
    const pct = p.subtotal ? Math.round((p.extras / p.subtotal) * 1000) / 10 : 0;
    return h('div', { class: `person${isPayer ? ' payer' : ''}`, 'data-testid': 'person-result', 'data-name': p.name },
      h('button', {
        class: 'person-head', type: 'button', 'aria-expanded': String(open),
        onclick: () => {
          if (open) expanded.delete(p.name);
          else expanded.add(p.name);
          ctx.rerender();
        },
      },
        h('span', null,
          h('span', { class: 'name' }, p.name),
          h('span', { class: 'pays' }, isPayer ? `paid ${formatCents(result.total)}` : `→ pays ${s.payer}`),
        ),
        h('span', { class: 'amount', 'data-testid': 'person-total' }, formatCents(p.total)),
      ),
      open
        ? h('div', { class: 'breakdown', 'data-testid': 'breakdown' },
          p.items.map((i) => h('div', { class: 'line' },
            h('span', null, i.name, i.n > 1 ? h('span', { class: 'muted' }, ` ÷ ${i.n}`) : null),
            h('span', null, formatCents(i.share)))),
          h('div', { class: 'line sub' }, h('span', null, 'Items'), h('span', null, formatCents(p.subtotal))),
          result.extras ? h('div', { class: 'line' }, h('span', null, `Tax, tip & fees (${pct}%)`), h('span', null, formatCents(p.extras))) : null,
          h('div', { class: 'line sub' }, h('span', null, 'Total'), h('span', null, formatCents(p.total))),
        )
        : null,
    );
  });

  const mismatch = r.total != null && r.total !== result.total;
  const card = h('article', { class: 'card', 'data-testid': 'results-card' },
    h('div', { class: 'card-head' },
      h('span', { class: 'merchant', 'data-testid': 'result-merchant' }, r.merchant || 'Receipt'),
      r.date ? h('span', { class: 'date' }, r.date) : null,
    ),
    people,
    h('div', { class: 'card-total' },
      h('span', null, 'Total'),
      h('span', { 'data-testid': 'result-total' }, formatCents(result.total)),
    ),
    mismatch ? h('p', { class: 'small', style: { color: 'var(--warn)', margin: '0 0 8px' } }, `The receipt says ${formatCents(r.total)}.`) : null,
    h('div', { class: 'card-foot' }, 'Tap a name for the breakdown · split with iou'),
  );

  const linkBox = h('input', { type: 'text', readonly: true, hidden: true, 'data-testid': 'share-url', 'aria-label': 'Share link', onfocus: (e) => e.target.select() });

  const copy = async () => {
    const url = shareUrl(s);
    linkBox.value = url;
    linkBox.hidden = false;
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    } catch {
      linkBox.focus();
      toast('Copy the link below');
    }
  };

  return h('section', { class: 'stack' },
    card,
    h('div', { class: 'row' },
      h('button', { class: 'btn primary grow', type: 'button', 'data-testid': 'copy-link', onclick: copy }, 'Copy link'),
      navigator.share
        ? h('button', {
          class: 'btn grow', type: 'button',
          onclick: () => navigator.share({ title: `${r.merchant || 'Receipt'} split`, url: shareUrl(s) }).catch(() => {}),
        }, 'Share')
        : null,
    ),
    linkBox,
    h('div', { class: 'row' },
      h('button', { class: 'btn grow', type: 'button', 'data-testid': 'edit', onclick: () => ctx.go('assign') }, 'Edit'),
      h('button', { class: 'btn grow', type: 'button', 'data-testid': 'new-receipt', onclick: () => ctx.reset() }, 'New receipt'),
    ),
  );
}
