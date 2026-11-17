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
  const editor = app.request.locator('.response-tabs .ace_editor');
  await expect(editor).toBeVisible();
  const wrapping = () => editor.evaluate((el: any) => el.env.editor.session.getUseWrapMode());
  expect(await editor.evaluate((el: any) => el.env.editor.getValue())).toBe(body.slice(0, 8192));
  await expect.poll(wrapping).toBe(false);
  await app.request.getByRole('button', { name: 'Next part', exact: true }).click();
  expect(await editor.evaluate((el: any) => el.env.editor.getValue())).toBe(body.slice(8192, 16384));
  await app.request.getByRole('button', { name: 'Previous part', exact: true }).click();
  const wrap = app.request.getByRole('button', { name: 'Wrap lines', exact: true });
  await expect(wrap).toHaveAttribute('aria-pressed', 'false');
  await wrap.click();
  await expect.poll(wrapping).toBe(true);
  await expect(wrap).toHaveAttribute('aria-pressed', 'true');
  await app.request.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(wrap).toHaveAttribute('aria-pressed', 'false');
  await app.setMockResponse({ contentType: 'text/plain', body: 'short response' });
  await app.request.getByRole('button', { name: 'Send', exact: true }).click();
  const raw = app.request.locator('pre.response-pre');
  await expect(raw).toHaveText('short response');
  await expect(raw).toHaveCSS('white-space', 'pre-wrap');
});

test('keeps large Raw rendering bounded while switching response panels', async ({ app }) => {
  await app.setMockResponse({ contentType: 'text/plain', body: JSON.stringify({ payload: '部门'.repeat(500000), end: 'complete' }) });
  await app.request.getByRole('button', { name: 'Send', exact: true }).click();
  await app.request.getByRole('tab', { name: 'Raw', exact: true }).click();
  const viewer = app.request.locator('.response-tabs .ace_editor');
  await expect(viewer).toBeVisible();
  await expect.poll(() => viewer.locator('.ace_text-layer').evaluate(el => el.textContent?.length || 0)).toBeLessThan(20000);
  await app.request.getByTitle('Search in response', { exact: true }).click();
  await app.request.getByPlaceholder('Search...').fill('complete');
  await expect.poll(() => viewer.evaluate((el: any) => el.env.editor.getSelectedText())).toBe('complete');
  await expect(viewer.locator('.ace_text-layer')).toContainText('complete');
  await app.request.getByTitle('Close search', { exact: true }).click();
  for (let i = 0; i < 2; i++) {
    await app.request.locator('.response-tabs').getByRole('tab', { name: 'Headers', exact: true }).click();
    await expect(app.request.locator('.response-tabs')).toContainText('text/plain');
    await app.request.locator('.response-tabs').getByRole('tab', { name: /Test Results/ }).click();
    await app.request.locator('.response-tabs').getByRole('tab', { name: 'Body', exact: true }).click();
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('.ace_text-layer')).toContainText(/payload|complete/);
  }
});
