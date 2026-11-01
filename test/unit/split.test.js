import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitReceipt, settle, formatCents, SplitError } from '../../src/split.js';

const totals = (result) => Object.fromEntries(result.people.map((p) => [p.name, p.total]));
const sum = (result) => result.people.reduce((s, p) => s + p.total, 0);

export const SAMPLE_PEOPLE = ['Ada', 'Ben', 'Cleo', 'Dev'];
const trio = ['Ben', 'Cleo', 'Dev'];
export const sample = {
  items: [
    { name: 'Roast Chicken', price: 2800, assignees: ['Ada'] },
    { name: 'Tomato Soup', price: 1200, assignees: ['Ben'] },
    { name: 'Pork Chop', price: 3400, assignees: ['Cleo'] },
    { name: 'Risotto', price: 2600, assignees: ['Dev'] },
    { name: 'Imaginaire', price: 5800, assignees: trio },
    { name: 'Muscadel', price: 6400, assignees: trio },
    { name: 'Calamari', price: 1600, assignees: trio },
    { name: 'Caesar', price: 1400, assignees: trio },
    { name: 'Bread and Butter', price: 600, assignees: SAMPLE_PEOPLE },
  ],
  extras: [
    { kind: 'fee', label: 'Kitchen Staff Fee', amount: 774 },
    { kind: 'tax', label: 'Tax', amount: 1806 },
    { kind: 'tip', label: 'Tip', amount: 5315 },
  ],
};

test('Sample receipt: matches a hand calculation', () => {
  const r = splitReceipt(sample, SAMPLE_PEOPLE);
  assert.deepEqual(totals(r), { Dev: 10209, Cleo: 11253, Ada: 3853, Ben: 8380 });
  assert.equal(sum(r), 33695);
  assert.equal(r.total, 33695);
  assert.equal(r.subtotal, 25800);
  assert.equal(r.extras, 7895);
});

test('Sample receipt: breakdown subtotals and extras add up per person and overall', () => {
  const r = splitReceipt(sample, SAMPLE_PEOPLE);
  for (const p of r.people) assert.equal(p.subtotal + p.extras, p.total);
  assert.equal(r.people.reduce((s, p) => s + p.subtotal, 0), 25800);
  const dev = r.people.find((p) => p.name === 'Dev');
  assert.equal(dev.subtotal, 7816);
  assert.deepEqual(dev.items.map((i) => i.name), ['Risotto', 'Imaginaire', 'Muscadel', 'Calamari', 'Caesar', 'Bread and Butter']);
  assert.equal(dev.items.find((i) => i.name === 'Bread and Butter').share, 150);
});

test('Big bill: half-cent ties break by the order people were added', () => {
  const people = ['Dev', 'Ada', 'Cleo', 'Ben'];
  const receipt = {
    items: [10687, 34200, 1499].map((price, i) => ({ name: `Item ${i + 1}`, price, assignees: people })),
    extras: [],
  };
  const r = splitReceipt(receipt, people);
  assert.equal(r.total, 46386);
  assert.deepEqual(totals(r), { Dev: 11597, Ada: 11597, Cleo: 11596, Ben: 11596 });
  assert.equal(sum(r), 46386);

  const reordered = splitReceipt(receipt, ['Ben', 'Cleo', 'Ada', 'Dev']);
  assert.deepEqual(totals(reordered), { Ben: 11597, Cleo: 11597, Ada: 11596, Dev: 11596 });
});

test('a $0 item is fine and costs nothing', () => {
  const r = splitReceipt({
    items: [
      { name: 'Water', price: 0, assignees: ['A', 'B'] },
      { name: 'Burger', price: 1500, assignees: ['A'] },
    ],
    extras: [{ kind: 'tax', amount: 150 }],
  }, ['A', 'B']);
  assert.deepEqual(totals(r), { A: 1650, B: 0 });
});

test('an item with one assignee goes entirely to them, with a proportional share of extras', () => {
  const r = splitReceipt({
    items: [{ name: 'Steak', price: 3000, assignees: ['B'] }, { name: 'Salad', price: 1000, assignees: ['A'] }],
    extras: [{ kind: 'tip', amount: 800 }],
  }, ['A', 'B']);
  assert.deepEqual(totals(r), { A: 1200, B: 3600 });
});

test('extras with no priced items are an error', () => {
  assert.throws(
    () => splitReceipt({ items: [], extras: [{ kind: 'tip', amount: 500 }] }, ['A']),
    SplitError,
  );
  assert.throws(
    () => splitReceipt({ items: [{ name: 'Free', price: 0, assignees: ['A'] }], extras: [{ kind: 'tax', amount: 1 }] }, ['A']),
    SplitError,
  );
});

test('no items and no extras splits to zero', () => {
  const r = splitReceipt({ items: [], extras: [] }, ['A', 'B']);
  assert.deepEqual(totals(r), { A: 0, B: 0 });
});

test('a negative discount reduces everyone in proportion', () => {
  const r = splitReceipt({
    items: [{ name: 'X', price: 3000, assignees: ['A'] }, { name: 'Y', price: 1000, assignees: ['B'] }],
    extras: [{ kind: 'discount', label: 'Promo', amount: -1000 }, { kind: 'tax', amount: 333 }],
  }, ['A', 'B']);
  assert.equal(r.total, 3333);
  assert.equal(sum(r), 3333);
  // Exact: A 2499.75, B 833.25 -> A gets the extra cent (larger remainder).
  assert.deepEqual(totals(r), { A: 2500, B: 833 });
});

test('one person pays everything', () => {
  const r = splitReceipt(sample.items.length && {
    items: sample.items.map((i) => ({ ...i, assignees: ['Solo'] })),
    extras: sample.extras,
  }, ['Solo']);
  assert.deepEqual(totals(r), { Solo: 33695 });
});

test('names differing only by whitespace are the same person', () => {
  const r = splitReceipt({
    items: [
      { name: 'A', price: 1000, assignees: [' Ada', 'Ada  '] },
      { name: 'B', price: 1000, assignees: ['Mary  Jo', 'Ada'] },
    ],
    extras: [],
  }, ['Ada ', '  Mary Jo', 'Ada']);
  assert.deepEqual(totals(r), { Ada: 1500, 'Mary Jo': 500 });
});

test('unassigned items and unknown people are errors', () => {
  assert.throws(() => splitReceipt({ items: [{ name: 'X', price: 100, assignees: [] }] }, ['A']), /not assigned/);
  assert.throws(() => splitReceipt({ items: [{ name: 'X', price: 100, assignees: ['Z'] }] }, ['A']), /not one of the people/);
  assert.throws(() => splitReceipt({ items: [{ name: 'X', price: 1.5, assignees: ['A'] }] }, ['A']), /cents/);
  assert.throws(() => splitReceipt({ items: [] }, []), /at least one person/);
});

test('rounding always sums exactly, across many awkward splits', () => {
  const people = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  let seed = 7;
  const rand = (n) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
  for (let trial = 0; trial < 300; trial++) {
    const items = Array.from({ length: 1 + rand(8) }, (_, i) => {
      const who = people.filter(() => rand(2));
      return { name: `i${i}`, price: 1 + rand(9999), assignees: who.length ? who : ['A'] };
    });
    const extras = [{ kind: 'tax', amount: rand(2000) }, { kind: 'tip', amount: rand(3000) }, { kind: 'discount', amount: -rand(500) }];
    const r = splitReceipt({ items, extras }, people);
    assert.equal(sum(r), r.total);
    for (const p of r.people) assert.ok(Number.isInteger(p.total));
  }
});

test('settle: each receipt allocates its own extras, debts go to that receipt\'s payer', () => {
  const people = ['A', 'B', 'C'];
  const dinner = {
    items: [{ name: 'X', price: 3000, assignees: ['A', 'B', 'C'] }],
    extras: [{ kind: 'tip', amount: 600 }],
  };
  const drinks = {
    items: [{ name: 'Y', price: 1000, assignees: ['A', 'B'] }],
    extras: [], // no tip on drinks: C must not pay any of dinner's tip twice or drinks' share
  };
  const { debts, perPerson } = settle([{ receipt: dinner, payer: 'A' }, { receipt: drinks, payer: 'B' }], people);
  assert.deepEqual(debts, [
    { from: 'B', to: 'A', amount: 1200 },
    { from: 'C', to: 'A', amount: 1200 },
    { from: 'A', to: 'B', amount: 500 },
  ]);
  assert.deepEqual(Object.fromEntries(perPerson), { A: 1700, B: 1700, C: 1200 });
});

test('formatCents', () => {
  assert.equal(formatCents(33695), '$336.95');
  assert.equal(formatCents(5), '$0.05');
  assert.equal(formatCents(123456789), '$1,234,567.89');
  assert.equal(formatCents(-1000), '−$10.00');
  assert.equal(formatCents(1933.3333), '$19.33');
});
