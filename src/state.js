// App state, plus encode/decode of a finished split into the URL hash (#s=<base64url JSON>).
// The hash is never sent to the server, so a shared link carries the whole split privately.
import { normName } from './split.js';

let nextId = 1;
export const newId = () => `r${nextId++}`;

export const EXTRA_KINDS = ['tax', 'tip', 'fee', 'discount'];
export const EXTRA_LABELS = { tax: 'Tax', tip: 'Tip', fee: 'Fee', discount: 'Discount' };

export function emptyReceipt() {
  return { merchant: '', date: '', items: [], extras: [], total: null, rawText: '', warnings: [], usable: true };
}

export function createState() {
  return {
    screen: 'capture',
    receipt: emptyReceipt(),
    people: [],
    payer: null,
    image: null, // decoded photo (ImageBitmap/canvas); never serialised
    crop: null, // {x, y, w, h} in image pixels
  };
}

export const newItem = (name = '', price = null, qty = 1) => ({ id: newId(), name, qty, price, assignees: [] });
export const newExtra = (kind = 'tax', amount = null, label = '') => ({ id: newId(), kind, label: label || EXTRA_LABELS[kind], amount });

/** Load a parseReceipt() result into the editable receipt. */
export function receiptFromParse(parsed) {
  return {
    merchant: parsed.merchant,
    date: parsed.date,
    items: parsed.items.map((i) => ({ ...newItem(i.name, i.price, i.qty), fuzzy: Boolean(i.fuzzy) })),
    extras: parsed.extras.map((x) => newExtra(x.kind, x.amount, x.label)),
    total: parsed.total,
    rawText: parsed.rawText,
    warnings: parsed.warnings,
    usable: parsed.usable,
  };
}

export const itemLabel = (item, index) => {
  const name = item.name.trim() || `Item ${index + 1}`;
  return item.qty > 1 ? `${item.qty}× ${name}` : name;
};

/** Add a person (trimmed, de-duplicated). Returns the normalised name, or null if it was empty/duplicate. */
export function addPerson(state, raw) {
  const name = normName(raw);
  if (!name || state.people.includes(name)) return null;
  state.people.push(name);
  if (!state.payer) state.payer = name;
  return name;
}

export function removePerson(state, name) {
  state.people = state.people.filter((p) => p !== name);
  for (const item of state.receipt.items) item.assignees = item.assignees.filter((p) => p !== name);
  if (state.payer === name) state.payer = state.people[0] ?? null;
}

/** The receipt in the shape split.js expects. */
export function toSplitInput(state) {
  return {
    items: state.receipt.items.map((i, n) => ({ name: itemLabel(i, n), price: i.price ?? 0, assignees: i.assignees })),
    extras: state.receipt.extras.filter((x) => x.amount != null).map((x) => ({ kind: x.kind, label: x.label, amount: x.amount })),
  };
}

// ---- URL hash ----

const toBase64Url = (bytes) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64Url = (s) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

export function encodeSplit(state) {
  const people = state.people;
  const r = state.receipt;
  const data = {
    v: 1,
    m: r.merchant,
    d: r.date,
    p: people,
    y: Math.max(0, people.indexOf(state.payer)),
    i: r.items.map((i) => [i.name, i.qty, i.price ?? 0, i.assignees.map((a) => people.indexOf(a)).filter((n) => n >= 0)]),
    x: r.extras.filter((x) => x.amount != null).map((x) => [x.kind, x.label, x.amount]),
    t: r.total,
  };
  return toBase64Url(new TextEncoder().encode(JSON.stringify(data)));
}

/** Decode a hash payload into a fresh state on the results screen. Throws on malformed input. */
export function decodeSplit(payload) {
  const data = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
  if (data?.v !== 1 || !Array.isArray(data.p) || !Array.isArray(data.i)) throw new Error('Unrecognised link');
  const isCents = (n) => Number.isSafeInteger(n);
  const state = createState();
  for (const p of data.p) addPerson(state, String(p));
  state.payer = state.people[data.y] ?? state.people[0] ?? null;
  state.receipt = {
    ...emptyReceipt(),
    merchant: String(data.m ?? ''),
    date: String(data.d ?? ''),
    total: isCents(data.t) ? data.t : null,
    items: data.i.map(([name, qty, price, who]) => {
      if (!isCents(price)) throw new Error('Bad price in link');
      const item = newItem(String(name ?? ''), price, Number.isInteger(qty) && qty > 0 ? qty : 1);
      item.assignees = (Array.isArray(who) ? who : []).map((n) => state.people[n]).filter(Boolean);
      return item;
    }),
    extras: (Array.isArray(data.x) ? data.x : []).map(([kind, label, amount]) => {
      if (!isCents(amount)) throw new Error('Bad amount in link');
      return newExtra(EXTRA_KINDS.includes(kind) ? kind : 'fee', amount, String(label ?? ''));
    }),
  };
  state.screen = 'results';
  return state;
}

// ---- Recent names (localStorage, this device only) ----

const RECENT_KEY = 'iou.recentNames';

export function loadRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((n) => typeof n === 'string').slice(0, 12) : [];
  } catch {
    return [];
  }
}

export function rememberNames(names) {
  try {
    const merged = [...names, ...loadRecent().filter((n) => !names.includes(n))].slice(0, 12);
    localStorage.setItem(RECENT_KEY, JSON.stringify(merged));
  } catch {
    // storage unavailable (private mode): recent names are a convenience only
  }
}
