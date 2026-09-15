import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  await page.setContent(
    '<style>body { margin: 0; background: transparent }</style>' +
      (await readFile('public/icon.svg', 'utf8')),
  );
  await mkdir('assets', { recursive: true });
  await page.screenshot({ path: 'assets/icon.png', omitBackground: true });
} finally {
  await browser.close();
}
