import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseReceipt, reconcile, matchPrice, classify, parseAmount } from '../../src/parse.js';

const fixture = (name) => readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8');

export const SAMPLE_ITEMS = [
  ['Roast Chicken', 2800],
  ['Tomato Soup', 1200],
  ['Pork Chop', 3400],
  ['Risotto', 2600],
  ['BTL Cuvee Imaginaire Rouge', 5800],
  ['Bread and Butter', 600],
  ['Fried Calamari', 1600],
  ['Caesar Salad', 1400],
  ['BTL Domaine Des Songes Muscadel', 6400],
];

const extra = (r, kind) => r.extras.filter((x) => x.kind === kind).map((x) => x.amount);

test('Sample cropped OCR text: items, extras, totals, merchant, date', () => {
  const r = parseReceipt(fixture('sample_ocr_cropped.txt'));
  assert.deepEqual(r.items.map((i) => [i.name, i.price]), SAMPLE_ITEMS);
  assert.ok(r.items.every((i) => i.qty === 1));
  assert.deepEqual(r.extras, [
    { kind: 'fee', label: 'Kitchen Staff Fee (3.00%)', amount: 774 },
    { kind: 'tax', label: 'Tax', amount: 1806 },
    { kind: 'tip', label: 'Tip', amount: 5315 },
  ]);
  assert.equal(r.subtotal, 26574);
  assert.equal(r.total, 33695);
  assert.equal(r.merchant, 'Imaginary Bistro');
  assert.equal(r.date, '06/14/25');
  assert.equal(r.usable, true);
  assert.deepEqual(r.warnings, []);
  assert.equal(reconcile(r).status, 'ok');
});

test('noisy OCR: junk is tolerated, prices still come out right', () => {
  const r = parseReceipt(fixture('sample_ocr_noisy.txt'));
  assert.deepEqual(r.items.map((i) => i.price), SAMPLE_ITEMS.map(([, p]) => p));
  assert.deepEqual(r.items.map((i) => i.name), SAMPLE_ITEMS.map(([n]) => n));
  assert.equal(r.subtotal, 26574);
  assert.equal(r.total, 33695);
  assert.deepEqual(extra(r, 'tax'), [1806]);
  assert.deepEqual(extra(r, 'tip'), [5315]);
  assert.deepEqual(extra(r, 'fee'), [774]);
  assert.equal(r.merchant, 'Imaginary Bistro');
  assert.equal(reconcile(r).status, 'ok');
  // The repaired price is flagged so the user can double-check it.
  assert.equal(r.items[4].fuzzy, true);
  assert.equal(r.warnings.length, 1);
});

test('a genuinely misread price is caught by reconciliation', () => {
  // A plausible misread: the $7.74 fee read as $1.74.
  const r = parseReceipt(fixture('sample_ocr_cropped.txt').replace('$7.74', '$1.74'));
  const check = reconcile(r);
  assert.equal(check.status, 'mismatch');
  assert.equal(check.diff, 600);
  assert.match(r.warnings.at(-1), /add up to \$330\.95.*\$336\.95/);
});

test('text after Total never creates items', () => {
  const text = `Cafe
1 Latte $5.00
Total $5.00
Suggested Additional Tip: + 2%: (Tip $5.31 Total $342.26)
+ 3%: (Tip $7.97 Total $344.92)
Coffee beans $18.00`;
  const r = parseReceipt(text);
  assert.deepEqual(r.items.map((i) => i.name), ['Latte']);
  assert.deepEqual(r.extras, []);
  assert.equal(r.total, 500);
});

test('OCR-mangled keywords: Tota1, Tota], Subtota1, TAX', () => {
  assert.equal(classify('Tota1 '), 'total');
  assert.equal(classify('Tota] '), 'total');
  assert.equal(classify('TOTAL'), 'total');
  assert.equal(classify('Subtota1'), 'subtotal');
  assert.equal(classify('Sub-Total'), 'subtotal');
  assert.equal(classify('MA Meals TAX'), 'tax');
  assert.equal(classify('Gratuity 20%'), 'tip');
  assert.equal(classify('Service Charge'), 'fee');
  assert.equal(classify('Card Surcharge'), 'fee');
  assert.equal(classify('Staff Appreciation Fee (3.00%)'), 'fee');
  assert.equal(classify('Happy hour promo'), 'discount');
  assert.equal(classify('Comp dessert'), 'discount');
  assert.equal(classify('Coffee'), 'item');
  assert.equal(classify('Tipsy Tart'), 'item');
  assert.equal(classify('Compote'), 'item');
});

test('discounts become negative extras, whether printed negative or not', () => {
  const r = parseReceipt(`Diner
2 Fries $8.00
Burger $12.00
Promo -$3.00
Comp ($2.00)
Discount $1.00
Subtotal $14.00
Total $14.00`);
  assert.deepEqual(r.items, [{ name: 'Fries', qty: 2, price: 800 }, { name: 'Burger', qty: 1, price: 1200 }]);
  assert.deepEqual(r.extras.map((x) => [x.kind, x.amount]), [['discount', -300], ['discount', -200], ['discount', -100]]);
  assert.equal(reconcile(r).status, 'ok');
});

test('wrapped names only join onto the following priced line', () => {
  const r = parseReceipt(`Place
Table 4
1 Short $1.00
Very long dish name that
wraps $2.00
2 Another $3.00`);
  assert.deepEqual(r.items.map((i) => [i.name, i.qty, i.price]), [
    ['Short', 1, 100],
    ['Very long dish name that wraps', 1, 200],
    ['Another', 2, 300],
  ]);
});

test('header lines are never glued onto the first item', () => {
  const r = parseReceipt(`Place
Ordered: 06/14/25 8:05 PM
Party of four
1 Soup $4.00`);
  assert.deepEqual(r.items.map((i) => i.name), ['Soup']);
});

test('unknown charge between Subtotal and Total is kept as an extra', () => {
  const r = parseReceipt(`Bar
Beer $7.00
Subtotal $7.00
Health SF $0.42
Total $7.42`);
  assert.deepEqual(r.extras, [{ kind: 'fee', label: 'Health SF', amount: 42 }]);
  assert.equal(reconcile(r).status, 'ok');
});

test('price matching edge cases', () => {
  assert.deepEqual(matchPrice('Wine $1,234.50'), { cents: 123450, label: 'Wine', fuzzy: false });
  assert.deepEqual(matchPrice('Soup 4.00 |)'), { cents: 400, label: 'Soup', fuzzy: false });
  assert.equal(matchPrice('$58.0(').cents, 5800);
  assert.equal(matchPrice('Fee $7.7O').cents, 770);
  assert.equal(matchPrice('Ordered: 06/14/25 8:05 PM'), null);
  assert.equal(matchPrice('Kitchen fee (3.00%)'), null);
  assert.equal(matchPrice('Guest Count: 4'), null);
});

test('nothing usable: still returns raw text for the editor', () => {
  const r = parseReceipt('a blurry mess\n~~~ ::: ');
  assert.equal(r.usable, false);
  assert.deepEqual(r.items, []);
  assert.equal(r.rawText, 'a blurry mess\n~~~ ::: ');
  assert.equal(reconcile(r).status, 'unknown');
  assert.equal(parseReceipt('').usable, false);
});

test('parseAmount', () => {
  assert.equal(parseAmount('12.5'), 1250);
  assert.equal(parseAmount('$1,234.56'), 123456);
  assert.equal(parseAmount('-3'), -300);
  assert.equal(parseAmount('.99'), 99);
  assert.equal(parseAmount('7.'), 700);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount('1.234'), null);
});

test('short trailing tokens after a price: tax flags and background specks', () => {
  assert.equal(matchPrice('Milk 2% 3.49 F').cents, 349);
  assert.equal(matchPrice('Bananas 1.29 T').cents, 129);
  assert.equal(matchPrice('1 Tomato Soup                  $12.00              g').cents, 1200);
  assert.equal(matchPrice('Total                           $336.95       Pr').cents, 33695);
  assert.equal(matchPrice('Soup $4.00 x2'), null);
  const r = parseReceipt('Shop\nMilk 3.49 F\nBread 2.99\nSubtotal 6.48\nTax 0.00\nTotal 6.48 T');
  assert.deepEqual(r.items.map((i) => [i.name, i.price]), [['Milk', 349], ['Bread', 299]]);
  assert.equal(r.total, 648);
});
