import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { expect } from '@playwright/test';

export const FIXTURE_TEXT = readFileSync(new URL('../../fixtures/sample_ocr_cropped.txt', import.meta.url), 'utf8');

const privateDir = new URL('../../fixtures/private/', import.meta.url);
export const PRIVATE_PHOTO = existsSync(privateDir)
  ? readdirSync(privateDir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).map((f) => new URL(f, privateDir).pathname)[0]
  : undefined;

export const PRIVATE_HEIC = existsSync(privateDir)
  ? readdirSync(privateDir).filter((f) => /\.hei[cf]$/i.test(f)).map((f) => new URL(f, privateDir).pathname)[0]
  : undefined;

// What the private photo(s) should read as. Kept next to the photo, gitignored, so real amounts never get
// committed. Shape: { "prices": [cents, ...], "subtotal": cents, "total": cents,
//                   "extras": [["fee", cents], ...], "merchant": "...", "date": "M/D/YY" }
const expectedFile = new URL('expected.json', privateDir);
export const PRIVATE_EXPECTED = existsSync(expectedFile) ? JSON.parse(readFileSync(expectedFile, 'utf8')) : undefined;

export const PEOPLE = ['Ada', 'Ben', 'Cleo', 'Dev'];
export const PAYER = 'Ben';
const trio = ['Ben', 'Cleo', 'Dev'];
export const ASSIGNMENTS = [
  ['Roast Chicken', ['Ada']],
  ['Tomato Soup', ['Ben']],
  ['Pork Chop', ['Cleo']],
  ['Risotto', ['Dev']],
  ['Imaginaire', trio],
  ['Muscadel', trio],
  ['Calamari', trio],
  ['Caesar', trio],
  ['Bread and Butter', 'everyone'],
];
export const SAMPLE_PRICES = ['28.00', '12.00', '34.00', '26.00', '58.00', '6.00', '16.00', '14.00', '64.00'];
export const SAMPLE_TOTAL = '$336.95';
export const EXPECTED = { Ada: '$38.53', Ben: '$83.80', Cleo: '$112.53', Dev: '$102.09' };

/** Record every request that would leave this machine. */
export function watchNetwork(page) {
  const offsite = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (['data:', 'blob:'].includes(url.protocol)) return;
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) offsite.push(req.url());
  });
  return offsite;
}

export async function addPeople(page, names) {
  for (const name of names) {
    await page.getByTestId('person-input').fill(name);
    await page.getByTestId('person-input').press('Enter');
  }
  await expect(page.getByTestId('person-chip')).toHaveCount(names.length);
}

export async function assignAll(page, assignments = ASSIGNMENTS) {
  for (const [match, who] of assignments) {
    const item = page.locator('[data-testid=assign-item]', { hasText: match });
    await expect(item).toHaveCount(1);
    const head = item.locator('.assign-head');
    if ((await head.getAttribute('aria-expanded')) !== 'true') await head.tap();
    if (who === 'everyone') {
      await item.getByTestId('assign-everyone').tap();
    } else {
      for (const name of who) await item.getByTestId('assign-person').filter({ hasText: new RegExp(`^${name}$`) }).tap();
    }
    await expect(item).not.toHaveClass(/unassigned/);
  }
}

export async function expectTotals(page, expected = EXPECTED, total = SAMPLE_TOTAL) {
  for (const [name, amount] of Object.entries(expected)) {
    await expect(page.locator(`[data-testid=person-result][data-name="${name}"] [data-testid=person-total]`)).toHaveText(amount);
  }
  await expect(page.getByTestId('result-total')).toHaveText(total);
}
