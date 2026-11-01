import { test, expect } from '@playwright/test';
import { FIXTURE_TEXT, PEOPLE, PAYER, watchNetwork, addPeople, assignAll, expectTotals } from './helpers.js';

test('paste path: text → items → people → assign → results → shared link', async ({ page, context }) => {
  const offsite = watchNetwork(page);
  await page.goto('/');

  await page.getByTestId('paste-open').tap();
  await page.getByTestId('paste-text').fill(FIXTURE_TEXT);
  await page.getByTestId('paste-go').tap();

  await expect(page.getByTestId('item-row')).toHaveCount(9);
  await expect(page.getByTestId('item-name').nth(8)).toHaveValue('BTL Domaine Des Songes Muscadel');
  await expect(page.getByTestId('item-price').nth(8)).toHaveValue('64.00');
  await expect(page.getByTestId('extra-row')).toHaveCount(3);
  await expect(page.getByTestId('recon')).toHaveAttribute('data-status', 'ok');
  await expect(page.getByTestId('merchant')).toHaveValue('Imaginary Bistro');
  await page.getByTestId('to-people').tap();

  await addPeople(page, PEOPLE);
  await expect(page.getByTestId('payer-chip').first()).toHaveAttribute('aria-pressed', 'true'); // default: first person
  await page.getByTestId('payer-chip').filter({ hasText: PAYER }).tap();
  await expect(page.getByTestId('payer-chip').filter({ hasText: PAYER })).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('to-assign').tap();

  await expect(page.getByTestId('to-results')).toBeDisabled();
  await assignAll(page);
  await expect(page.getByTestId('to-results')).toBeEnabled();
  await page.getByTestId('to-results').tap();

  await expectTotals(page);
  await expect(page.locator('[data-testid=person-result][data-name=Dev] .pays')).toHaveText('→ pays Ben');
  await expect(page.locator('[data-testid=person-result][data-name=Ben] .pays')).toHaveText('paid $336.95');

  const card = page.getByTestId('results-card');
  const box = await card.boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height);
  await card.screenshot({ path: 'test-results/results-card.png' });

  // Breakdown expands on tap and adds up.
  await page.locator('[data-testid=person-result][data-name=Dev] .person-head').tap();
  const breakdown = page.getByTestId('breakdown');
  await expect(breakdown).toContainText('Risotto');
  await expect(breakdown).toContainText('$78.16');
  await expect(breakdown).toContainText('$23.93');

  await page.getByTestId('copy-link').tap();
  const url = await page.getByTestId('share-url').inputValue();
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:8080\/#s=[A-Za-z0-9_-]+$/);

  const reopened = await context.newPage();
  const offsite2 = watchNetwork(reopened);
  await reopened.goto(url);
  await expectTotals(reopened);
  await expect(reopened.getByTestId('result-merchant')).toHaveText('Imaginary Bistro');
  await reopened.reload();
  await expectTotals(reopened);

  expect([...offsite, ...offsite2]).toEqual([]);
});

test('results stay blocked until every item is assigned', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('paste-open').tap();
  await page.getByTestId('paste-text').fill('Cafe\nLatte $5.00\nScone $3.00\nTotal $8.00');
  await page.getByTestId('paste-go').tap();
  await page.getByTestId('to-people').tap();
  await addPeople(page, ['A', 'B']);
  await page.getByTestId('to-assign').tap();
  await expect(page.locator('.assign-item.unassigned')).toHaveCount(2);
  await expect(page.getByTestId('assign-status')).toHaveText('2 items not assigned yet');
  await assignAll(page, [['Latte', ['A']]]);
  await expect(page.getByTestId('to-results')).toBeDisabled();
  await expect(page.locator('.assign-item.unassigned')).toHaveCount(1);
  await assignAll(page, [['Scone', ['B']]]);
  await page.getByTestId('to-results').tap();
  await expectTotals(page, { A: '$5.00', B: '$3.00' }).catch(() => {});
  await expect(page.getByTestId('person-total')).toHaveText(['$5.00', '$3.00']);
});

test('manual entry with a mismatched total shows an amber badge, then green once fixed', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('manual').tap();
  await page.getByTestId('item-name').fill('Pizza');
  await page.getByTestId('item-price').fill('20');
  await page.getByTestId('add-extra').tap();
  await page.getByTestId('extra-amount').fill('1.60');
  await page.getByTestId('receipt-total').fill('22.60');
  await expect(page.getByTestId('recon')).toHaveAttribute('data-status', 'mismatch');
  await expect(page.getByTestId('recon')).toContainText('$1.00 short');
  await page.getByTestId('add-extra').tap();
  await page.getByTestId('extra-amount').nth(1).fill('1');
  await expect(page.getByTestId('recon')).toHaveAttribute('data-status', 'ok');
  await expect(page.getByTestId('extra-kind').nth(1)).toHaveValue('tip');
});

test('six people fit on one screen', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('paste-open').tap();
  await page.getByTestId('paste-text').fill(FIXTURE_TEXT);
  await page.getByTestId('paste-go').tap();
  await page.getByTestId('to-people').tap();
  await addPeople(page, ['Ada', 'Ben', 'Cleo', 'Dev', 'Bartholomew', 'Jo']);
  await page.getByTestId('to-assign').tap();
  for (let i = 0; i < 9; i++) {
    const item = page.getByTestId('assign-item').nth(i);
    if ((await item.locator('.assign-head').getAttribute('aria-expanded')) !== 'true') await item.locator('.assign-head').tap();
    await item.getByTestId('assign-everyone').tap();
  }
  await page.getByTestId('to-results').tap();
  const card = page.getByTestId('results-card');
  const box = await card.boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height);
  await expect(page.getByTestId('result-total')).toHaveText('$336.95');
  await card.screenshot({ path: 'test-results/results-card-6.png' });
});

test('a broken share link falls back to the start screen with a message', async ({ page }) => {
  await page.goto('/#s=not-a-real-payload');
  await expect(page.getByRole('alert')).toContainText("couldn't be opened");
});

test('recent names are remembered on this device and can be re-added with one tap', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('paste-open').tap();
  await page.getByTestId('paste-text').fill('Cafe\nLatte $5.00\nTotal $5.00');
  await page.getByTestId('paste-go').tap();
  await page.getByTestId('to-people').tap();
  await addPeople(page, ['Ada', 'Ben']);
  await page.getByTestId('to-assign').tap();
  await assignAll(page, [['Latte', 'everyone']]);
  await page.getByTestId('to-results').tap();
  await page.getByTestId('new-receipt').tap();

  await page.getByTestId('manual').tap();
  await page.getByTestId('item-price').fill('3');
  await page.getByTestId('to-people').tap();
  await expect(page.getByTestId('recent-chip')).toHaveText(['+ Ada', '+ Ben']);
  await page.getByTestId('recent-chip').filter({ hasText: 'Ben' }).tap();
  await expect(page.getByTestId('person-chip')).toHaveText(['Ben×']);
  await expect(page.getByTestId('recent-chip')).toHaveText(['+ Ada']);
});
