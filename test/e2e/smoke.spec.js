import { test, expect } from '@playwright/test';

test('app shell loads with the privacy footer', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.goto('/');
  await expect(page).toHaveTitle('iou');
  await expect(page.locator('footer')).toHaveText('Runs on your phone. Nothing is uploaded.');
  expect(errors).toEqual([]);
});

test('paste box stays hidden until "Paste receipt text" is tapped', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('paste-text')).toBeHidden();
  await page.getByTestId('paste-open').tap();
  await expect(page.getByTestId('paste-text')).toBeVisible();
  await page.getByTestId('paste-open').tap();
  await expect(page.getByTestId('paste-text')).toBeHidden();
});
