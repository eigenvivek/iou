// Regenerates docs/screenshots/*.png for the README, using the committed text fixture only
// (never a private receipt photo). Usage: npm run screenshots
import { chromium, devices } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';

const port = 8091;
const server = spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 400));
const out = 'docs/screenshots';
mkdirSync(out, { recursive: true });
const text = readFileSync('fixtures/sample_ocr_cropped.txt', 'utf8');
const trio = ['Ben', 'Cleo', 'Dev'];
const assignments = [
  ['Roast Chicken', ['Ada']], ['Tomato Soup', ['Ben']], ['Pork Chop', ['Cleo']], ['Risotto', ['Dev']],
  ['Imaginaire', trio], ['Muscadel', trio], ['Calamari', trio], ['Caesar', trio], ['Bread and Butter', 'everyone'],
];

const browser = await chromium.launch();
try {
  for (const scheme of ['light', 'dark']) {
    const context = await browser.newContext({ ...devices['iPhone 13'], colorScheme: scheme, serviceWorkers: 'block' });
    const page = await context.newPage();
    const shot = (name) => page.screenshot({ path: `${out}/${name}-${scheme}.png` });
    await page.goto(`http://127.0.0.1:${port}/`);
    if (scheme === 'light') await shot('1-capture');
    await page.getByTestId('paste-open').tap();
    await page.getByTestId('paste-text').fill(text);
    await page.getByTestId('paste-go').tap();
    if (scheme === 'light') await shot('2-items');
    await page.getByTestId('to-people').tap();
    for (const name of ['Ada', 'Ben', 'Cleo', 'Dev']) {
      await page.getByTestId('person-input').fill(name);
      await page.getByTestId('person-input').press('Enter');
    }
    await page.getByTestId('payer-chip').filter({ hasText: 'Ben' }).tap();
    await page.getByTestId('to-assign').tap();
    for (const [match, who] of assignments) {
      const item = page.locator('[data-testid=assign-item]', { hasText: match });
      const head = item.locator('.assign-head');
      if ((await head.getAttribute('aria-expanded')) !== 'true') await head.tap();
      if (who === 'everyone') await item.getByTestId('assign-everyone').tap();
      else for (const n of who) await item.getByTestId('assign-person').filter({ hasText: new RegExp(`^${n}$`) }).tap();
      if (match === 'Imaginaire' && scheme === 'light') await shot('3-assign');
    }
    await page.getByTestId('to-results').tap();
    await shot('4-results');
    await context.close();
  }
} finally {
  await browser.close();
  server.kill();
}
console.log(`screenshots written to ${out}/`);
