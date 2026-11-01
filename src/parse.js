// Pure receipt-text parser. No DOM. Money is integer cents.
//
// parseReceipt(text) → { merchant, date, items: [{name, qty, price}], extras: [{kind, label, amount}],
//                        subtotal, total, warnings, usable, rawText }
// extras.kind is one of 'tax' | 'tip' | 'fee' | 'discount' (discount amounts are negative).

// Trailing OCR junk that can follow a price: bars, brackets, stars, stray punctuation.
// Also short digit-free tokens: tax flags on grocery receipts ("4.99 T") and specks of background ("$18.00  g").
const JUNK = String.raw`(?:[\s|()\[\]{}*#'"\`.,:;!_~—–-]|\s[^\s\d]{1,3}(?=\s|$))*`;
const PRICE_STRICT = new RegExp(String.raw`(-)?\s?\$?\s?(\d{1,4}(?:,\d{3})*)\.(\d{2})${JUNK}$`);
// A price whose last digit was misread as a look-alike character, e.g. "$62.0(" or "$9.6O".
const DIGIT_LOOKALIKES = { O: '0', o: '0', Q: '0', D: '0', '(': '0', ')': '0', '[': '1', ']': '1', '|': '1', l: '1', I: '1', i: '1', '!': '1', S: '5', s: '5', B: '8', Z: '2', z: '2', g: '9' };
const PRICE_FUZZY = new RegExp(String.raw`(-)?\s?\$\s?(\d{1,4}(?:,\d{3})*)\.(\d)([OoQD()\[\]|lIi!SsBZzg])${JUNK}$`);
const DATE = /\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/;
const QTY = /^(\d{1,2})\s*[xX×]?\s+(?=\S*[A-Za-z])/;

/** Find a price at the end of a line. Returns { cents, label, fuzzy } or null. */
export function matchPrice(line) {
  let m = PRICE_STRICT.exec(line);
  let fuzzy = false;
  let cents;
  if (m) {
    cents = Number(m[2].replace(/,/g, '')) * 100 + Number(m[3]);
  } else {
    m = PRICE_FUZZY.exec(line);
    if (!m) return null;
    fuzzy = true;
    cents = Number(m[2].replace(/,/g, '')) * 100 + Number(m[3]) * 10 + Number(DIGIT_LOOKALIKES[m[4]]);
  }
  let label = line.slice(0, m.index);
  let negative = Boolean(m[1]);
  // "($5.00)" style negatives
  if (/\(\s*$/.test(label) && m[0].includes(')')) {
    negative = true;
    label = label.replace(/\(\s*$/, '');
  }
  return { cents: negative ? -cents : cents, label, fuzzy };
}

/** Normalise a label for keyword matching, undoing common OCR letter/digit confusions. */
function keywordForm(label) {
  return label
    .toLowerCase()
    .replace(/[1|\]\[!]/g, 'l')
    .replace(/0/g, 'o')
    .replace(/5/g, 's')
    .replace(/[^a-z]+/g, ' ')
    .trim();
}

/** Classify a priced line's label. */
export function classify(label) {
  const k = keywordForm(label);
  if (/\bsub ?tota?l\b/.test(k)) return 'subtotal';
  if (/\b(tax|taxes|hst|gst|vat)\b/.test(k)) return 'tax';
  if (/\b(tip|tips|gratuity)\b/.test(k)) return 'tip';
  if (/\b(tota?l|amount due|balance due|total due)\b/.test(k)) return 'total';
  if (/\b(discount|promo|promotion|coupon|comp|comped|complimentary)\b/.test(k)) return 'discount';
  if (/\b(fee|fees|service|surcharge|appreciation)\b/.test(k)) return 'fee';
  return 'item';
}

function cleanText(text) {
  return text
    .replace(/^[\s|*#'"`.,:;!_~•·—–-]+/, '')
    .replace(/[\s|*#'"`.,:;!_~•·$—–-]+$/, '')
    // "Muscade]" → "Muscadel": a bar or bracket glued to lowercase letters is almost always an "l".
    .replace(/(?<=[a-z])[\]|](?=[a-z]|\b|$)/g, 'l')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanItemName(label) {
  let name = cleanText(label);
  let qty = 1;
  const q = QTY.exec(name);
  if (q) {
    qty = Number(q[1]) || 1;
    name = name.slice(q[0].length);
  }
  return { name: cleanText(name), qty };
}

const hasLetters = (s) => /[A-Za-z]{2,}/.test(s);

export function parseReceipt(text) {
  const rawText = String(text ?? '');
  const lines = rawText.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\t/g, ' ').trimEnd());

  const result = {
    merchant: '',
    date: '',
    items: [],
    extras: [],
    subtotal: null,
    total: null,
    warnings: [],
    usable: false,
    rawText,
  };

  const firstLine = lines.find((l) => hasLetters(l));
  if (firstLine) result.merchant = cleanText(firstLine);
  const dateMatch = rawText.match(DATE);
  if (dateMatch) result.date = dateMatch[0];

  let pending = null; // a price-less line that may be the first half of a wrapped item name
  let seenSubtotal = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      pending = null;
      continue;
    }
    const price = matchPrice(line);
    if (!price) {
      pending = !seenSubtotal && hasLetters(line) && !/:/.test(line) ? { text: line, at: i } : null;
      continue;
    }

    const kind = classify(price.label);
    if (price.fuzzy) {
      result.warnings.push(`Check "${line}": read as $${(Math.abs(price.cents) / 100).toFixed(2)}`);
    }

    if (kind === 'total') {
      result.total = price.cents;
      break; // everything after the total is card details, suggested tips, etc.
    }
    if (kind === 'subtotal') {
      result.subtotal = price.cents;
      seenSubtotal = true;
      pending = null;
      continue;
    }
    if (kind !== 'item') {
      const amount = kind === 'discount' ? -Math.abs(price.cents) : price.cents;
      result.extras.push({ kind, label: cleanText(price.label) || kind, amount });
      pending = null;
      continue;
    }

    let label = price.label;
    if (
      pending &&
      pending.at === i - 1 &&
      !QTY.test(cleanText(label)) &&
      (result.items.length > 0 || QTY.test(cleanText(pending.text)))
    ) {
      label = `${pending.text} ${label}`;
    }
    pending = null;

    if (seenSubtotal) {
      // An unrecognised charge between Subtotal and Total is still part of the bill.
      result.extras.push({ kind: 'fee', label: cleanText(label) || 'Other', amount: price.cents });
      continue;
    }
    const { name, qty } = cleanItemName(label);
    result.items.push({ name, qty, price: price.cents, ...(price.fuzzy ? { fuzzy: true } : {}) });
  }

  result.usable = result.items.length > 0;

  const check = reconcile(result);
  if (check.status === 'mismatch') {
    result.warnings.push(`Items and extras add up to $${(check.sum / 100).toFixed(2)}, but the receipt total is $${(result.total / 100).toFixed(2)}`);
  }
  return result;
}

/**
 * Compare items + extras with the printed total.
 * @returns {{status: 'ok'|'mismatch'|'unknown', sum: number, diff: number}} diff = total - sum
 */
export function reconcile({ items, extras, total }) {
  const sum = items.reduce((s, i) => s + (i.price || 0), 0) + extras.reduce((s, x) => s + (x.amount || 0), 0);
  if (total == null || Number.isNaN(total)) return { status: 'unknown', sum, diff: 0 };
  const diff = total - sum;
  return { status: diff === 0 ? 'ok' : 'mismatch', sum, diff };
}

/** Parse a user-typed amount like "12.5", "$1,234.56", "-3" into cents. Returns null if invalid. */
export function parseAmount(input) {
  const s = String(input ?? '').trim().replace(/[$,\s]/g, '').replace(/^−/, '-');
  if (!s) return null;
  const m = /^(-)?(\d*)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m || (!m[2] && !m[3])) return null;
  const cents = Number(m[2] || 0) * 100 + Number((m[3] || '').padEnd(2, '0'));
  return m[1] ? -cents : cents;
}
