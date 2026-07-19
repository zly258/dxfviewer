import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

test('loads an opened URL once and renders the drawing', async ({ page }) => {
  const fixture = await readFile(path.resolve(process.cwd(), 'tests/fixtures/basic-ascii.dxf'));
  let requestCount = 0;
  await page.route('**/basic-ascii.dxf', async route => {
    requestCount += 1;
    await route.fulfill({ status: 200, contentType: 'application/dxf', body: fixture });
  });

  await page.goto('/');
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('open-dxf-url', { detail: { url: '/basic-ascii.dxf' } }));
  });

  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.loading-overlay')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('.status-summary .status-value').nth(1)).toHaveText('2');
  expect(requestCount).toBe(1);
});
