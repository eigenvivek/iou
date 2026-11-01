// Pure split logic. No DOM. All money is integer cents.
//
// A receipt is { items: [{ name, price, assignees: [personName] }], extras: [{ kind, label, amount }] }.
// Item prices are split evenly among assignees. Extras (tax, tip, fees, negative discounts) are allocated
// in proportion to each person's item subtotal. Per-person totals are rounded with the largest-remainder
// method so they sum to the receipt total exactly; ties go to whoever was added first.

export class SplitError extends Error {}

export const normName = (name) => String(name ?? '').trim().replace(/\s+/g, ' ');

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const lcm = (a, b) => (a / gcd(a, b)) * b;
const floorDiv = (n, d) => {
  const q = n / d;
  return n % d !== 0n && (n < 0n) !== (d < 0n) ? q - 1n : q;
};

function assertCents(value, what) {
  if (!Number.isSafeInteger(value)) throw new SplitError(`${what} must be a whole number of cents, got ${value}`);
}

/**
 * Split one receipt among people.
 * @param {{items: Array, extras?: Array}} receipt
 * @param {string[]} people  names in the order they were added (the tie-break order)
 * @returns {{ people: Array<{name, items: Array<{name, price, share, n}>, subtotal, extras, total}>,
 *             subtotal: number, extras: number, total: number }}
 *   `share` is the person's exact share of an item in cents (may be fractional, for display only).
 *   `subtotal`, `extras`, `total` per person are integer cents; extras = total - subtotal.
 */
export function splitReceipt(receipt, people) {
  const names = [];
  const index = new Map();
  for (const raw of people) {
    const name = normName(raw);
    if (!name) throw new SplitError('Person names cannot be empty');
    if (index.has(name)) continue;
    index.set(name, names.length);
    names.push(name);
  }
  if (!names.length) throw new SplitError('Add at least one person');

  const items = receipt.items ?? [];
  const extras = receipt.extras ?? [];

  // Exact per-person item subtotals, scaled by L = lcm(assignee counts) so they stay integers.
  let L = 1;
  const resolved = items.map((item, i) => {
    assertCents(item.price, `Price of "${item.name}"`);
    const who = [...new Set((item.assignees ?? []).map(normName))];
    if (!who.length) throw new SplitError(`"${item.name || `Item ${i + 1}`}" is not assigned to anyone`);
    for (const n of who) if (!index.has(n)) throw new SplitError(`"${n}" is not one of the people`);
    L = lcm(L, who.length);
    return { name: item.name, price: item.price, who: who.map((n) => index.get(n)) };
  });

  const scaled = names.map(() => 0n); // subtotal_i * L
  const lines = names.map(() => []);
  for (const it of resolved) {
    const each = BigInt(it.price) * BigInt(L / it.who.length);
    for (const p of it.who) {
      scaled[p] += each;
      lines[p].push({ name: it.name, price: it.price, share: it.price / it.who.length, n: it.who.length });
    }
  }

  let extrasTotal = 0;
  for (const x of extras) {
    assertCents(x.amount, `${x.label || x.kind || 'Extra'} amount`);
    extrasTotal += x.amount;
  }
  const subtotal = resolved.reduce((s, it) => s + it.price, 0);
  const total = subtotal + extrasTotal;

  if (subtotal === 0 && extrasTotal !== 0) {
    throw new SplitError('Tax, tip, and fees need at least one item with a price to be split against');
  }
  if (total < 0) throw new SplitError('The total cannot be negative');

  // Largest remainder on exact totals: total_i = scaled_i * total / (subtotal * L).
  const roundShares = (numerators, denominator, target) => {
    if (denominator === 0n) return numerators.map(() => 0);
    const floors = numerators.map((n) => floorDiv(n, denominator));
    const rems = numerators.map((n, i) => n - floors[i] * denominator);
    let left = BigInt(target) - floors.reduce((a, b) => a + b, 0n);
    const order = names.map((_, i) => i).sort((a, b) => (rems[b] > rems[a] ? 1 : rems[b] < rems[a] ? -1 : a - b));
    const out = floors.slice();
    for (const i of order) {
      if (left <= 0n) break;
      out[i] += 1n;
      left -= 1n;
    }
    return out.map(Number);
  };

  const D = BigInt(subtotal) * BigInt(L);
  const totals = roundShares(scaled.map((s) => s * BigInt(total)), D, total);
  const subtotals = roundShares(scaled, BigInt(L), subtotal);

  return {
    subtotal,
    extras: extrasTotal,
    total,
    people: names.map((name, i) => ({
      name,
      items: lines[i],
      subtotal: subtotals[i],
      extras: totals[i] - subtotals[i],
      total: totals[i],
    })),
  };
}

/**
 * Settle several receipts, each with its own payer. Extras stay within their own receipt.
 * @param {Array<{receipt, payer: string}>} bills
 * @param {string[]} people
 * @returns {{ debts: Array<{from, to, amount}>, perPerson: Map<string, number> }}
 *   debts are what each non-payer owes each payer (one entry per pair, amounts in cents).
 */
export function settle(bills, people) {
  const owed = new Map();
  const perPerson = new Map(people.map((p) => [normName(p), 0]));
  for (const { receipt, payer } of bills) {
    const to = normName(payer);
    const result = splitReceipt(receipt, people);
    for (const p of result.people) {
      perPerson.set(p.name, perPerson.get(p.name) + p.total);
      if (p.name === to || p.total === 0) continue;
      const key = `${p.name}\u0000${to}`;
      owed.set(key, (owed.get(key) ?? 0) + p.total);
    }
  }
  const debts = [...owed].map(([key, amount]) => {
    const [from, to] = key.split('\u0000');
    return { from, to, amount };
  });
  return { debts, perPerson };
}

export function formatCents(cents, { sign = false } = {}) {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const s = `$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
  return neg ? `−${s}` : sign && cents > 0 ? `+${s}` : s;
}
