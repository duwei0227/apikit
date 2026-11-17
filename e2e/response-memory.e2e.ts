import { expect, test } from './fixtures/app';

test.beforeEach(async ({ app }) => {
  await app.open();
  await app.newRequest();
  await app.url.fill('https://api.example.com/tree');
});

test('renders JSON sent as text/plain in the read-only JSON editor without rounding integers', async ({ app }) => {
  await app.setMockResponse({ contentType: 'text/plain;charset=UTF-8', body: '[{"id":852633836497678336,"name":"部门"}]' });
  await app.request.getByRole('button', { name: 'Send', exact: true }).click();
  const editor = app.request.locator('.code-editor-container');
  await expect(editor.locator('.ace_editor')).toBeVisible();
  await expect(editor.locator('.ace_content')).toContainText('852633836497678336');
  await expect(editor.locator('.ace_variable')).toContainText(['"id"', '"name"']);
});

test('disables wrapping for long Raw lines, allows opting in, and resets for each response', async ({ app }) => {
  const body = JSON.stringify({ payload: 'x'.repeat(20000), end: 'complete' });
  await app.setMockResponse({ contentType: 'text/plain', body });
  await app.request.getByRole('button', { name: 'Send', exact: true }).click();
  await app.request.getByRole('tab', { name: 'Raw', exact: true }).click();
  const raw = app.request.locator('pre.response-pre');
  await expect(raw).toHaveCSS('white-space', 'pre');
  await expect(raw).toHaveText(body);
  const wrap = app.request.getByRole('button', { name: 'Wrap lines', exact: true });
  await expect(wrap).toHaveAttribute('aria-pressed', 'false');
  await wrap.click();
  await expect(raw).toHaveCSS('white-space', 'pre-wrap');
  await expect(wrap).toHaveAttribute('aria-pressed', 'true');
  await app.request.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(wrap).toHaveAttribute('aria-pressed', 'false');
  await app.setMockResponse({ contentType: 'text/plain', body: 'short response' });
  await app.request.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(raw).toHaveText('short response');
  await expect(raw).toHaveCSS('white-space', 'pre-wrap');
});
