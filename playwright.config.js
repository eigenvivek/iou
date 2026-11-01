import { defineConfig, devices } from '@playwright/test';

const iphone = devices['iPhone 13'];

export default defineConfig({
  testDir: 'test/e2e',
  outputDir: 'test-results/artifacts',
  timeout: 120_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8080',
    serviceWorkers: 'block',
  },
  // iPhone viewport + touch, on Chromium. Playwright's WebKit build fails on macOS 14
  // ("Unknown setting: PushAPIEnabled"), so real Safari is covered by the manual phone smoke test.
  projects: [
    { name: 'chromium-iphone', use: { ...iphone, browserName: 'chromium' } },
  ],
  webServer: {
    command: 'node scripts/serve.mjs',
    url: 'http://127.0.0.1:8080/index.html',
    reuseExistingServer: !process.env.CI,
  },
});
