import { test, expect } from '@playwright/test';
import { FIXTURE_TEXT } from './helpers.js';

test.use({ serviceWorkers: 'allow' });

test('works offline after the first visit, including the OCR engine files', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now controlled by the service worker
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('footer')).toHaveText('Runs on your phone. Nothing is uploaded.');
  const cached = await page.evaluate(async () => {
    const files = ['vendor/tesseract/eng.traineddata.gz', 'vendor/tesseract/tesseract-core-simd-lstm.wasm', 'vendor/tesseract/worker.min.js'];
    return Promise.all(files.map(async (f) => (await fetch(f)).ok));
  });
  expect(cached).toEqual([true, true, true]);

  await page.getByTestId('paste-open').tap();
  await page.getByTestId('paste-text').fill(FIXTURE_TEXT);
  await page.getByTestId('paste-go').tap();
  await expect(page.getByTestId('item-row')).toHaveCount(9);
});

test('manifest is valid for Add to Home Screen', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.display).toBe('standalone');
  expect(m.icons.some((i) => i.sizes === '512x512')).toBe(true);
  for (const icon of m.icons) expect((await request.get(`/${icon.src}`)).ok()).toBe(true);
});
