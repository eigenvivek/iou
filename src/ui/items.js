import { h } from '../dom.js';
import { parseAmount, reconcile } from '../parse.js';
import { formatCents } from '../split.js';
import { EXTRA_KINDS, EXTRA_LABELS, newExtra, newItem } from '../state.js';

const showAmount = (cents) => (cents == null ? '' : (Math.abs(cents) / 100).toFixed(2));

export function render(ctx) {
  const r = ctx.state.receipt;

  const badge = h('div', { class: 'badge', 'data-testid': 'recon', role: 'status' });
  const next = h('button', { class: 'btn primary', type: 'button', 'data-testid': 'to-people', onclick: () => ctx.go('people') }, 'Next: people');

  function refresh() {
    const valid = r.items.length > 0 && r.items.every((i) => i.price != null) && r.extras.every((x) => x.amount != null);
    next.disabled = !valid;
    const check = reconcile({ items: r.items, extras: r.extras.filter((x) => x.amount != null), total: r.total });
    if (check.status === 'ok') {
      badge.className = 'badge ok';
      badge.dataset.status = 'ok';
      badge.replaceChildren(h('span', null, '✓ Matches receipt total'), h('span', null, formatCents(check.sum)));
    } else if (check.status === 'mismatch') {
      badge.className = 'badge warn';
      badge.dataset.status = 'mismatch';
      const word = check.diff > 0 ? 'short' : 'over';
      badge.replaceChildren(
        h('span', null, `${formatCents(Math.abs(check.diff))} ${word} of the receipt total`),
        h('span', null, `${formatCents(check.sum)} / ${formatCents(r.total)}`),
      );
    } else {
      badge.className = 'badge none';
      badge.dataset.status = 'unknown';
      badge.replaceChildren(h('span', null, 'Add the receipt total to double-check'), h('span', null, formatCents(check.sum)));
    }
  }

  const amountInput = (value, testid, onValue) => {
    const input = h('input', {
      class: 'price', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00',
      'data-testid': testid, value: showAmount(value), 'aria-label': 'Amount',
      oninput: () => {
        const cents = parseAmount(input.value);
        input.setAttribute('aria-invalid', cents == null && input.value.trim() !== '' ? 'true' : 'false');
        onValue(input.value.trim() === '' ? null : cents);
        refresh();
      },
      onblur: () => {
        const cents = parseAmount(input.value);
        if (cents != null) input.value = showAmount(cents);
      },
    });
    return input;
  };

  const itemRows = r.items.map((item, idx) =>
    h('div', { class: 'item-row', 'data-testid': 'item-row' },
      h('input', {
        type: 'text', value: item.qty > 1 ? `${item.qty} ${item.name}` : item.name, placeholder: `Item ${idx + 1}`,
        'data-testid': 'item-name', 'aria-label': 'Item name', autocomplete: 'off',
        oninput: (e) => {
          const m = /^(\d{1,2})\s+(.*)$/.exec(e.target.value);
          item.qty = m && Number(m[1]) > 1 ? Number(m[1]) : 1;
          item.name = item.qty > 1 ? m[2] : e.target.value;
        },
      }),
      amountInput(item.price, 'item-price', (cents) => {
        item.price = cents == null ? null : Math.abs(cents);
        item.fuzzy = false;
      }),
      h('button', {
        class: 'icon-btn', type: 'button', 'aria-label': `Delete ${item.name || 'item'}`, 'data-testid': 'item-delete',
        onclick: () => {
          r.items.splice(idx, 1);
          ctx.rerender();
        },
      }, '×'),
    ),
  );

  const extraRows = r.extras.map((extra, idx) => {
    const label = h('input', {
      type: 'text', value: extra.label, 'aria-label': 'Label', 'data-testid': 'extra-label', autocomplete: 'off',
      oninput: (e) => { extra.label = e.target.value; },
    });
    return h('div', { class: 'extra-row', 'data-testid': 'extra-row' },
      h('select', {
        'aria-label': 'Kind', 'data-testid': 'extra-kind',
        onchange: (e) => {
          const was = extra.kind;
          extra.kind = e.target.value;
          if (extra.label === EXTRA_LABELS[was] || !extra.label) extra.label = label.value = EXTRA_LABELS[extra.kind];
          if (extra.amount != null) extra.amount = extra.kind === 'discount' ? -Math.abs(extra.amount) : Math.abs(extra.amount);
          refresh();
        },
      }, EXTRA_KINDS.map((k) => h('option', { value: k, selected: k === extra.kind }, EXTRA_LABELS[k]))),
      label,
      amountInput(extra.amount, 'extra-amount', (cents) => {
        extra.amount = cents == null ? null : extra.kind === 'discount' ? -Math.abs(cents) : cents;
      }),
      h('button', {
        class: 'icon-btn', type: 'button', 'aria-label': `Delete ${extra.label}`,
        onclick: () => {
          r.extras.splice(idx, 1);
          ctx.rerender();
        },
      }, '×'),
    );
  });

  const addRow = (list, make, selector) => {
    list.push(make());
    ctx.rerender();
    const rows = document.querySelectorAll(selector);
    rows[rows.length - 1]?.focus();
  };

  const warnings = (r.warnings ?? []).filter((w) => w.startsWith('Check'));

  const view = h('section', { class: 'stack' },
    h('h2', null, 'Check the items'),
    h('p', { class: 'lead' }, r.usable === false
      ? "Couldn't find any items. Add them below, using the text we read as a guide."
      : 'Fix anything that was misread. Prices are what the receipt says.'),
    h('div', { class: 'row' },
      h('input', { type: 'text', class: 'grow', value: r.merchant, placeholder: 'Restaurant', 'aria-label': 'Restaurant', 'data-testid': 'merchant', oninput: (e) => { r.merchant = e.target.value; } }),
      h('input', { type: 'text', value: r.date, placeholder: 'Date', 'aria-label': 'Date', style: { width: '112px' }, 'data-testid': 'date', oninput: (e) => { r.date = e.target.value; } }),
    ),
    warnings.length ? h('p', { class: 'small muted' }, warnings.join(' · ')) : null,
    h('h3', null, 'Items'),
    h('div', { class: 'list', 'data-testid': 'items' }, itemRows),
    h('button', { class: 'btn block', type: 'button', 'data-testid': 'add-item', onclick: () => addRow(r.items, () => newItem(), '[data-testid=item-name]') }, '+ Add item'),
    h('h3', null, 'Tax, tip, fees, discounts'),
    h('div', { class: 'list' }, extraRows),
    h('button', { class: 'btn block', type: 'button', 'data-testid': 'add-extra', onclick: () => addRow(r.extras, () => newExtra(r.extras.some((x) => x.kind === 'tax') ? 'tip' : 'tax'), '[data-testid=extra-amount]') }, '+ Add tax, tip, or fee'),
    h('h3', null, 'Receipt total'),
    h('div', { class: 'item-row' },
      h('span', { class: 'muted' }, 'Total printed on the receipt'),
      amountInput(r.total, 'receipt-total', (cents) => { r.total = cents == null ? null : Math.abs(cents); }),
      h('span'),
    ),
    badge,
    r.rawText ? h('details', { class: 'raw', open: r.usable === false }, h('summary', null, 'Text read from the receipt'), h('pre', { 'data-testid': 'raw-text' }, r.rawText)) : null,
    h('div', { class: 'sticky-actions' }, next),
  );
  refresh();
  return view;
}
