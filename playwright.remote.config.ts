import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
export default defineConfig({
  testDir: './tests/remote-e2e',
  timeout: 35_000,
  workers: 1,
  outputDir: 'test-results/remote',
  use: {
    viewport: { width: 393, height: 851 },
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
    launchOptions: existsSync('/usr/bin/google-chrome') ? { executablePath: '/usr/bin/google-chrome' } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
