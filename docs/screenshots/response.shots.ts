import { expect, test } from '../../e2e/fixtures/app';

test('response Raw wrapping option', async ({ app, page }) => {
  await app.open();
  await app.newRequest();
  await app.url.fill('https://api.example.com/organizations');
  await app.setMockResponse({ contentType: 'text/plain;charset=UTF-8', body: JSON.stringify({ organizations: Array.from({ length: 300 }, (_, i) => ({ id: i + 1, name: `Department ${i + 1}` })) }) });
  await app.request.getByRole('button', { name: 'Send', exact: true }).click();
  await app.request.getByRole('tab', { name: 'Raw', exact: true }).click();
  await expect(app.request.getByRole('button', { name: 'Wrap lines' })).toHaveAttribute('aria-pressed', 'false');
  await expect(app.request.locator('.response-tabs .ace_editor')).toBeVisible();
  await page.screenshot({ path: 'docs/public/screenshots/response-raw.png', animations: 'disabled' });
});
