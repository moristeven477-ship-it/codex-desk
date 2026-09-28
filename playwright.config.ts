import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:41973',
    viewport: { width: 1460, height: 980 },
    launchOptions: existsSync('/usr/bin/google-chrome') ? { executablePath: '/usr/bin/google-chrome' } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 41973 --strictPort',
    url: 'http://127.0.0.1:41973',
    reuseExistingServer: false,
  },
});
