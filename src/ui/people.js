import { h } from '../dom.js';
import { addPerson, loadRecent, removePerson } from '../state.js';

export function render(ctx) {
  const s = ctx.state;
  const input = h('input', {
    type: 'text', placeholder: 'Name', 'aria-label': 'Name', 'data-testid': 'person-input',
    autocomplete: 'off', autocapitalize: 'words', enterkeyhint: 'done',
  });
  const add = (name) => {
    if (addPerson(s, name)) {
      ctx.rerender();
      document.querySelector('[data-testid=person-input]')?.focus();
    }
  };
  const form = h('form', {
    class: 'row',
    onsubmit: (e) => {
      e.preventDefault();
      add(input.value);
    },
  }, input, h('button', { class: 'btn primary', type: 'submit', 'data-testid': 'person-add' }, 'Add'));

  const recent = loadRecent().filter((n) => !s.people.includes(n));

  return h('section', { class: 'stack' },
    h('h2', null, "Who's splitting?"),
    h('p', { class: 'lead' }, 'Add everyone at the table, including whoever paid.'),
    form,
    s.people.length
      ? h('div', { class: 'chips', 'data-testid': 'people' }, s.people.map((name) =>
        h('button', {
          class: 'chip', type: 'button', 'data-testid': 'person-chip', 'aria-label': `Remove ${name}`,
          onclick: () => {
            removePerson(s, name);
            ctx.rerender();
          },
        }, name, h('span', { class: 'x', 'aria-hidden': 'true' }, '×'))))
      : null,
    recent.length
      ? h('div', { class: 'stack' },
        h('h3', null, 'Recent'),
        h('div', { class: 'chips' }, recent.map((name) =>
          h('button', { class: 'chip ghost', type: 'button', 'data-testid': 'recent-chip', onclick: () => add(name) }, `+ ${name}`))))
      : null,
    s.people.length
      ? h('div', { class: 'stack' },
        h('h3', null, 'Who paid?'),
        h('div', { class: 'chips', role: 'radiogroup', 'data-testid': 'payer' }, s.people.map((name) =>
          h('button', {
            class: 'chip', type: 'button', role: 'radio', 'aria-checked': String(s.payer === name), 'aria-pressed': String(s.payer === name),
            'data-testid': 'payer-chip',
            onclick: () => {
              s.payer = name;
              ctx.rerender();
            },
          }, name))))
      : null,
    h('div', { class: 'sticky-actions' },
      h('button', {
        class: 'btn primary', type: 'button', 'data-testid': 'to-assign', disabled: !s.people.length,
        onclick: () => ctx.go('assign'),
      }, 'Next: who had what'),
    ),
  );
}
