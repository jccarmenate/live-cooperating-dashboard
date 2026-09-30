import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:4000', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /responsive\.spec/ },
    {
      // A touch phone: Android's user agent, touch and a mobile viewport. The responsive
      // scenarios place fingers by coordinates, so the viewport is pinned to 375 × 740.
      name: 'phone',
      use: { ...devices['Pixel 7'], viewport: { width: 375, height: 740 } },
      testMatch: /responsive\.spec/,
    },
  ],
  webServer: [
    {
      command: 'npm run dev -w @relay/sync-server',
      url: 'http://localhost:8787/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'npm run dev -w @relay/web',
      url: 'http://localhost:4000',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
