// {{变量}}：URL 与 Params 的双向同步、发送时替换，以及各处变量补全和参数提示浮层的显示。

import { AceEditorHandle, expect, expectOverlayVisible, test } from './fixtures/app';

const SUGGESTIONS = '.variable-suggestions';
const PARAM_HINT = '.ak-variable-param-hint';

test.beforeEach(async ({ app }) => {
  await app.open();
  await app.setGlobalVariables({ baseUrl: 'https://api.example.com', token: 'abc123', itemId: '7' });
  await app.newRequest();
});

test.describe('URL and params', () => {
  test('parses variables in the URL into params and keeps them as written', async ({ app, page }) => {
    await app.url.click();
    await page.keyboard.type('{{ba');
    await expect(page.locator(`${SUGGESTIONS} .text-primary`)).toHaveText(['baseUrl']);
    await page.keyboard.press('Enter');
    await page.keyboard.type('/items?id={{itemId}}&q=1');
    await app.blurInputs();

    await expect(app.url).toHaveValue('{{baseUrl}}/items?id={{itemId}}&q=1');
    expect(await app.params()).toEqual(['id={{itemId}}', 'q=1', '=']);
    // URL 中的变量按已定义着色
    await expect(app.url.locator('xpath=..').locator('.var-highlight-layer .variable-part-valid')).toHaveCount(2);
  });

  test('writes params with variables back to the URL', async ({ app, page }) => {
    await app.url.fill('{{baseUrl}}/items?id={{itemId}}&q=1');
    await app.blurInputs();
    const panel = app.requestPanel;

    await panel.getByPlaceholder('Value').first().click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('{{to');
    await expectOverlayVisible(page, SUGGESTIONS);
    await page.keyboard.press('Enter');
    await expect(app.url).toHaveValue('{{baseUrl}}/items?id={{token}}&q=1');

    const newRow = (await panel.getByPlaceholder('Key').count()) - 1;
    await panel.getByPlaceholder('Key').nth(newRow).click();
    await page.keyboard.type('ts');
    await panel.getByPlaceholder('Value').nth(newRow).click();
    await page.keyboard.type('{{$timestamp}}');
    await expect(app.url).toHaveValue('{{baseUrl}}/items?id={{token}}&q=1&ts={{$timestamp}}');

    // 禁用一行后 URL 中不再包含它，重新启用后恢复
    await panel.locator('.p-checkbox').nth(1).click();
    await expect(app.url).toHaveValue('{{baseUrl}}/items?id={{token}}&ts={{$timestamp}}');
    expect(await app.params()).toEqual(['id={{token}}', '!q=1', 'ts={{$timestamp}}', '=']);
    await panel.locator('.p-checkbox').nth(1).click();
    await expect(app.url).toHaveValue('{{baseUrl}}/items?id={{token}}&q=1&ts={{$timestamp}}');
  });

  test('parses mixed query strings and sends resolved values', async ({ app, page }) => {
    await app.url.fill('{{baseUrl}}/search?q=a b&tag={{token}}&empty=&{{itemId}}=v');
    await app.blurInputs();
    expect(await app.params()).toEqual(['q=a b', 'tag={{token}}', 'empty=', '{{itemId}}=v', '=']);

    await app.url.click();
    await page.keyboard.press('End');
    await page.keyboard.type('&s={{$sequence(');
    await expectOverlayVisible(page, PARAM_HINT);
    await page.keyboard.type('start=5)}}');
    await page.keyboard.press('Escape');

    await app.request.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => app.run(() => window.__sent.at(-1)?.url))
      .toBe('https://api.example.com/search?q=a%20b&tag=abc123&empty=&7=v&s=5');
  });
});

test.describe('variable popups', () => {
  test('show above other areas in headers, auth and the body editor', async ({ app, page }) => {
    await app.requestTab('Headers');
    await app.requestPanel.getByPlaceholder('Value').first().click();
    await page.keyboard.type('{{');
    await expectOverlayVisible(page, SUGGESTIONS);
    await page.keyboard.press('Escape');

    await app.requestTab('Authorization');
    await app.requestPanel.locator('.p-select, .p-dropdown').first().click();
    await page.getByRole('option', { name: 'Bearer Token' }).click();
    await app.request.getByPlaceholder('Enter bearer token').click();
    await page.keyboard.type('{{');
    await expectOverlayVisible(page, SUGGESTIONS);
    await page.keyboard.press('Escape');

    // Body 编辑器：响应展开后编辑区较矮，补全和参数提示要浮在响应区上方
    await app.url.fill('https://api.example.com/items');
    await app.setMockResponse({ body: JSON.stringify({ items: Array.from({ length: 40 }, (_, i) => i) }, null, 2) });
    await app.request.getByRole('button', { name: 'Send', exact: true }).click();
    await app.selectBodyType('json');
    const editor = new AceEditorHandle(page, app.request.locator('.json-editor-container'));
    await editor.waitReady();
    await editor.setDoc('{\n' + Array.from({ length: 30 }, (_, i) => `  "f${i}": ${i},`).join('\n') + '\n  "last": "|"\n}');
    await page.keyboard.type('{{');
    await expectOverlayVisible(page, '.ak-hints');
    await page.keyboard.type('$sequence(');
    await expectOverlayVisible(page, '.ak-param-hint');
    await page.keyboard.press('Escape');
  });

  test('open above fields near the bottom of the window and do not stay after switching tabs', async ({ app, page }) => {
    // 新请求的响应区默认折叠，参数表格可以排到窗口底部
    await app.url.fill('{{baseUrl}}/x?' + Array.from({ length: 14 }, (_, i) => `p${i}=${i}`).join('&'));
    await app.blurInputs();
    const lastValue = app.requestPanel.getByPlaceholder('Value').nth(13);
    await lastValue.scrollIntoViewIfNeeded();
    await lastValue.click();
    await page.keyboard.press('End');
    const inputTop = (await lastValue.boundingBox())!.y;
    expect(inputTop).toBeGreaterThan(600);

    await page.keyboard.type('{{');
    await expectOverlayVisible(page, SUGGESTIONS);
    expect((await page.locator(SUGGESTIONS).boundingBox())!.y).toBeLessThan(inputTop);
    await page.keyboard.type('$sequence(');
    await expectOverlayVisible(page, PARAM_HINT);

    await app.requestTab('Headers');
    await expect(page.locator(`${SUGGESTIONS}, ${PARAM_HINT}, .ak-hints, .ak-param-hint`)).toHaveCount(0);
  });

  test('show on top of the workflow inline request dialog', async ({ app, page }) => {
    await app.run(async () => {
      await window.__store('workflows').saveWorkflow({
        id: 'wf-vars', name: 'Vars flow', version: 1, createdAt: '', updatedAt: '',
        steps: [{
          id: 's1', type: 'request', name: 'Inline', enabled: true, requestSource: 'inline',
          inlineRequest: { id: 'inl', name: 'Inline', method: 'GET', url: '{{baseUrl}}/a?x=1', params: [{ key: 'x', value: '1', enabled: true }], headers: [], body: { type: 'none', raw: '', formData: [], urlencoded: [] }, auth: { type: 'none' } },
        }],
      });
    });
    await page.getByText('Workflows', { exact: true }).first().click();
    await page.getByText('Vars flow').first().click();
    await page.getByRole('button', { name: 'Edit Inline Request' }).click();
    const dialog = page.locator('.p-dialog').last();
    const url = dialog.getByPlaceholder('Enter request URL');
    await url.click();
    await page.keyboard.press('End');
    await page.keyboard.type('&y={{');
    await expectOverlayVisible(page, SUGGESTIONS);
    await page.keyboard.type('$sequence(');
    await expectOverlayVisible(page, PARAM_HINT);
    // Esc 只关闭浮层，不关闭对话框
    await page.keyboard.press('Escape');
    await expect(page.locator(PARAM_HINT)).toHaveCount(0);
    await expect(page.getByText('Discard inline request changes?')).toHaveCount(0);

    await dialog.getByRole('tab', { name: 'Body', exact: true }).first().click();
    await dialog.locator('label', { hasText: /^json$/ }).first().click();
    const editor = new AceEditorHandle(page, dialog.locator('.json-editor-container'));
    await editor.waitReady();
    await editor.setDoc('{"a": "|"}');
    await page.keyboard.type('{{');
    await expectOverlayVisible(page, '.ak-hints');
    await page.keyboard.type('$sequence(');
    await expectOverlayVisible(page, '.ak-param-hint');
    await page.keyboard.press('Escape');
    await expect(page.locator('.ak-param-hint')).toHaveCount(0);
    await expect(page.getByText('Discard inline request changes?')).toHaveCount(0);
    await expect(dialog).toBeVisible();
  });
});
