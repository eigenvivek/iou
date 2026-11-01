import { h } from '../dom.js';
import { formatCents } from '../split.js';
import { itemLabel } from '../state.js';

let openId = null;

const summary = (item, people) => {
  if (!item.assignees.length) return 'Tap to assign';
  if (people.length > 1 && people.every((p) => item.assignees.includes(p))) return 'Everyone';
  return people.filter((p) => item.assignees.includes(p)).join(', ');
};

export function render(ctx) {
  const { receipt, people } = ctx.state;
  // Drop assignments to people who were removed since.
  for (const item of receipt.items) item.assignees = item.assignees.filter((p) => people.includes(p));

  const left = receipt.items.filter((i) => !i.assignees.length).length;
  if (!receipt.items.some((i) => i.id === openId)) openId = receipt.items.find((i) => !i.assignees.length)?.id ?? null;

  const rows = receipt.items.map((item, idx) => {
    const open = item.id === openId;
    const toggle = (name) => {
      item.assignees = item.assignees.includes(name) ? item.assignees.filter((p) => p !== name) : [...item.assignees, name];
      ctx.rerender();
    };
    const everyone = people.every((p) => item.assignees.includes(p));
    return h('div', {
      class: `assign-item${item.assignees.length ? '' : ' unassigned'}`,
      'data-testid': 'assign-item',
      'data-name': itemLabel(item, idx),
    },
      h('button', {
        class: 'assign-head', type: 'button', 'aria-expanded': String(open),
        onclick: () => {
          openId = open ? null : item.id;
          ctx.rerender();
        },
      },
        h('span', { class: 'grow' }, itemLabel(item, idx), h('span', { class: 'who' }, summary(item, people))),
        h('span', { class: 'amt' }, formatCents(item.price ?? 0)),
      ),
      open
        ? h('div', { class: 'assign-body' },
          h('div', { class: 'chips' },
            people.length > 1
              ? h('button', {
                class: 'chip', type: 'button', 'aria-pressed': String(everyone), 'data-testid': 'assign-everyone',
                onclick: () => {
                  item.assignees = everyone ? [] : [...people];
                  ctx.rerender();
                },
              }, 'Everyone')
              : null,
            people.map((name) => h('button', {
              class: 'chip', type: 'button', 'aria-pressed': String(item.assignees.includes(name)),
              'data-testid': 'assign-person', onclick: () => toggle(name),
            }, name)),
          ))
        : null,
    );
  });

  return h('section', { class: 'stack' },
    h('h2', null, 'Who had what?'),
    h('p', { class: 'lead' }, 'Tap an item, then tap everyone who shared it. Tax, tip, and fees are split in proportion to what each person had.'),
    h('p', { class: left ? 'small' : 'small muted', 'data-testid': 'assign-status', style: left ? { color: 'var(--warn)', fontWeight: 600 } : null },
      left ? `${left} item${left === 1 ? '' : 's'} not assigned yet` : 'Everything is assigned.'),
    h('div', { class: 'list' }, rows),
    h('div', { class: 'sticky-actions' },
      h('button', {
        class: 'btn primary', type: 'button', 'data-testid': 'to-results', disabled: left > 0,
        onclick: () => ctx.go('results'),
      }, left ? `Assign ${left} more to see results` : 'See results'),
    ),
  );
}
