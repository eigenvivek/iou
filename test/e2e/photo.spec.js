import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  FIXTURE_TEXT, PRIVATE_PHOTO, PRIVATE_HEIC, PRIVATE_EXPECTED, PEOPLE, PAYER, SAMPLE_PRICES,
  watchNetwork, addPeople, assignAll, expectTotals,
} from './helpers.js';

const dollars = (cents) => (cents / 100).toFixed(2);
const privatePrices = () => PRIVATE_EXPECTED.prices.map(dollars);
const privateTotal = () => `$${(PRIVATE_EXPECTED.total / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

// Split every item among everyone. Works for any receipt, so it is used for the private photo.
async function assignEveryone(page) {
  const items = page.getByTestId('assign-item');
  for (let i = 0; i < await items.count(); i++) {
    const item = items.nth(i);
    if ((await item.locator('.assign-head').getAttribute('aria-expanded')) !== 'true') await item.locator('.assign-head').tap();
    await item.getByTestId('assign-everyone').tap();
  }
}

test('photo path: upload → crop → OCR → items → results (paste fallback without a private photo)', async ({ page }) => {
  test.setTimeout(180_000);
  const offsite = watchNetwork(page);
  await page.goto('/');

  const usePhoto = PRIVATE_PHOTO && PRIVATE_EXPECTED;
  if (usePhoto) {
    await page.getByTestId('photo-input').setInputFiles(PRIVATE_PHOTO);
    const box = page.getByTestId('crop-box');
    await expect(box).toBeVisible();
    // The auto-crop should hug the receipt, not the whole photo.
    const [x, y, w, h] = (await box.getAttribute('data-crop')).split(',').map(Number);
    expect(w * h).toBeLessThan(4284 * 5712 * 0.6);
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0);
    await page.getByTestId('crop-accept').tap();
    await expect(page.getByTestId('read-status')).toBeVisible();
    await expect(page.getByTestId('item-row')).toHaveCount(PRIVATE_EXPECTED.prices.length, { timeout: 120_000 });
  } else {
    test.info().annotations.push({ type: 'note', description: 'No private photo + expected.json in fixtures/private/, so the paste path was used instead.' });
    await page.getByTestId('paste-open').tap();
    await page.getByTestId('paste-text').fill(FIXTURE_TEXT);
    await page.getByTestId('paste-go').tap();
  }

  const prices = await page.getByTestId('item-price').evaluateAll((els) => els.map((e) => e.value));
  expect(prices).toEqual(usePhoto ? privatePrices() : SAMPLE_PRICES);
  await expect(page.getByTestId('recon')).toHaveAttribute('data-status', 'ok');
  await page.getByTestId('to-people').tap();
  await addPeople(page, PEOPLE);
  await page.getByTestId('payer-chip').filter({ hasText: PAYER }).tap();
  await page.getByTestId('to-assign').tap();
  if (usePhoto) {
    await assignEveryone(page);
    await page.getByTestId('to-results').tap();
    await expect(page.getByTestId('result-total')).toHaveText(privateTotal());
  } else {
    await assignAll(page);
    await page.getByTestId('to-results').tap();
    await expectTotals(page);
  }
  await page.getByTestId('results-card').screenshot({ path: 'test-results/results-card-photo.png' });

  expect(offsite).toEqual([]);
});

test('crop box can be dragged by its corner handle', async ({ page }) => {
  test.skip(!PRIVATE_PHOTO, 'needs a photo in fixtures/private/');
  await page.goto('/');
  await page.getByTestId('photo-input').setInputFiles(PRIVATE_PHOTO);
  const box = page.getByTestId('crop-box');
  const before = (await box.getAttribute('data-crop')).split(',').map(Number);
  const handle = await page.getByTestId('crop-br').boundingBox();
  const cx = handle.x + handle.width / 2;
  const cy = handle.y + handle.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 40, cy - 60, { steps: 5 });
  await page.mouse.up();
  const after = (await box.getAttribute('data-crop')).split(',').map(Number);
  expect(after[0]).toBe(before[0]);
  expect(after[1]).toBe(before[1]);
  expect(after[2]).toBeLessThan(before[2]);
  expect(after[3]).toBeLessThan(before[3]);
});

test('a corrupt HEIC shows a clear error and the paste fallback', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('photo-input').setInputFiles({ name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer: Buffer.from('not really an image') });
  await expect(page.getByRole('alert')).toContainText("Couldn't open that HEIC photo");
  await expect(page.getByTestId('paste-text')).toBeVisible();
});

test('HEIC: Chromium has no native decoder, so the bundled one converts it (dropped with no MIME type, like from Messages)', async ({ page }) => {
  const offsite = watchNetwork(page);
  await page.goto('/');
  const bytes = [...readFileSync(new URL('../../fixtures/synthetic_receipt.heic', import.meta.url))];
  await dropImage(page, { name: 'IMG_0042.HEIC', type: '', bytes });
  const box = page.getByTestId('crop-box');
  await expect(box).toBeVisible();
  const [x, y, w, h] = (await box.getAttribute('data-crop')).split(',').map(Number);
  expect(x).toBeGreaterThan(150);
  expect(w).toBeLessThan(320);
  expect(y).toBeGreaterThan(50);
  expect(h).toBeLessThan(700);
  expect(offsite).toEqual([]);
});

test('HEIC: a real iPhone photo, upright, read end to end', async ({ page }) => {
  test.skip(!PRIVATE_HEIC || !PRIVATE_EXPECTED, 'needs a .heic and expected.json in fixtures/private/');
  test.setTimeout(180_000);
  await page.goto('/');
  const bytes = [...readFileSync(PRIVATE_HEIC)];
  await dropImage(page, { name: 'IMG_0007.HEIC', type: 'image/heic', bytes });
  const box = page.getByTestId('crop-box');
  await expect(box).toBeVisible({ timeout: 30_000 });
  const [, , w, h] = (await box.getAttribute('data-crop')).split(',').map(Number);
  expect(h).toBeGreaterThan(w * 1.5); // a tall receipt: the iPhone's rotation was applied
  await page.getByTestId('crop-accept').tap();
  await expect(page.getByTestId('item-row')).toHaveCount(PRIVATE_EXPECTED.prices.length, { timeout: 120_000 });
  const prices = await page.getByTestId('item-price').evaluateAll((els) => els.map((e) => e.value));
  expect(prices).toEqual(privatePrices());
  await expect(page.getByTestId('recon')).toHaveAttribute('data-status', 'ok');
});

// Build a synthetic "receipt" (white paper on a brown table) inside the page and drop it as a file.
async function dropImage(page, { name = 'receipt.png', type = 'image/png', bytes } = {}) {
  const dt = await page.evaluateHandle(async ({ name, type, bytes }) => {
    let blob;
    if (bytes) {
      blob = new Blob([new Uint8Array(bytes)], { type });
    } else {
      const c = new OffscreenCanvas(600, 800);
      const g = c.getContext('2d');
      g.fillStyle = '#8a5a2b';
      g.fillRect(0, 0, 600, 800);
      g.fillStyle = '#f4f4f0';
      g.fillRect(200, 100, 220, 600);
      blob = await c.convertToBlob({ type: 'image/png' });
    }
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([blob], name, { type }));
    return dataTransfer;
  }, { name, type, bytes });
  const main = page.locator('main');
  await main.dispatchEvent('dragenter', { dataTransfer: dt });
  await main.dispatchEvent('dragover', { dataTransfer: dt });
  await main.dispatchEvent('drop', { dataTransfer: dt });
}

test('desktop: dropping a photo anywhere on the start screen opens the crop step', async ({ page }) => {
  await page.goto('/');
  await dropImage(page);
  const box = page.getByTestId('crop-box');
  await expect(box).toBeVisible();
  const [x, y, w, h] = (await box.getAttribute('data-crop')).split(',').map(Number);
  // It found the white "paper", not the whole table.
  expect(x).toBeGreaterThan(150);
  expect(w).toBeLessThan(320);
  expect(y).toBeGreaterThan(50);
  expect(h).toBeLessThan(700);
});

test('desktop: dropping a non-image explains what went wrong', async ({ page }) => {
  await page.goto('/');
  await dropImage(page, { name: 'notes.txt', type: 'text/plain', bytes: [104, 105] });
  await expect(page.getByRole('alert')).toContainText("isn't an image");
});

test('desktop: dropping a file on a later screen does nothing and does not navigate away', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('manual').tap();
  await dropImage(page);
  await expect(page.getByTestId('item-row')).toHaveCount(1);
  expect(new URL(page.url()).pathname).toBe('/');
});
