// 代码编辑器：请求 Body 编辑器（JsonEditor）和只读查看器（CodeEditor），均基于 Ace。

import { AceEditorHandle, expect, imeType, test } from './fixtures/app';

test.describe('request body editor', () => {
  let editor: AceEditorHandle;

  test.beforeEach(async ({ app, page }) => {
    await app.open();
    await app.setGlobalVariables({ token: 'abc123' });
    await app.newRequest();
    await app.selectBodyType('json');
    editor = new AceEditorHandle(page, app.request.locator('.json-editor-container'));
    await editor.waitReady();
  });

  test('bulk edits params, headers and both form body types with colon-separated rows', async ({ app }) => {
    const expectValueColumnAligned = async (rowSelector: string) => {
      const header = app.requestPanel.locator('.ak-key-value-table-header:visible > div').nth(2);
      const valueCell = app.requestPanel.locator(`${rowSelector}:visible`).first();
      await expect(header).toBeVisible();
      const [headerBox, valueBox] = await Promise.all([header.boundingBox(), valueCell.boundingBox()]);
      expect(headerBox).not.toBeNull();
      expect(valueBox).not.toBeNull();
      expect(Math.abs(headerBox!.x - valueBox!.x)).toBeLessThan(2);
    };

    await app.url.fill('https://api.example.com/items');
    await app.url.press('Tab');
    await app.requestTab('Params');
    await expectValueColumnAligned('input[placeholder="Value"]');
    await expect(app.requestPanel.locator('.ak-key-value-bulk-edit-button:visible')).toHaveClass(/ak-mode-toggle-bulk/);
    await app.request.getByRole('button', { name: 'Bulk Edit' }).click();
    await expect(app.requestPanel.getByRole('button', { name: 'Key-Value Edit' })).toHaveClass(/ak-mode-toggle-key-value/);
    const paramsText = app.request.getByRole('textbox', { name: 'Query Params bulk edit' });
    await paramsText.fill('page: 2\nfilter: one:two');
    await expect(app.url).toHaveValue('https://api.example.com/items?page=2&filter=one:two');
    await app.request.getByRole('button', { name: 'Key-Value Edit' }).click();
    await expect(app.requestPanel.locator('input[placeholder="Key"]').first()).toHaveValue('page');
    await expect(app.requestPanel.locator('input[placeholder="Value"]').nth(1)).toHaveValue('one:two');

    await app.requestTab('Headers');
    await expectValueColumnAligned('input[placeholder="Value"]');
    await expect(app.requestPanel.locator('.ak-key-value-bulk-edit-button:visible')).toHaveClass(/ak-mode-toggle-bulk/);
    await app.request.getByRole('button', { name: 'Bulk Edit' }).click();
    await expect(app.requestPanel.getByRole('button', { name: 'Key-Value Edit' })).toHaveClass(/ak-mode-toggle-key-value/);
    const headersText = app.request.getByRole('textbox', { name: 'Headers bulk edit' });
    await headersText.fill('X-Test: first:second');
    await app.request.getByRole('button', { name: 'Key-Value Edit' }).click();
    await expect(app.requestPanel.locator('input[placeholder="Key"]').first()).toHaveValue('X-Test');
    await expect(app.requestPanel.locator('input[placeholder="Value"]').first()).toHaveValue('first:second');

    await app.selectBodyType('form-data');
    await expectValueColumnAligned('.form-data-row input[placeholder="Value"]');
    await expect(app.requestPanel.locator('.ak-key-value-bulk-edit-button:visible')).toHaveClass(/ak-mode-toggle-bulk/);
    await app.requestPanel.getByRole('button', { name: 'Bulk Edit' }).click();
    await expect(app.requestPanel.getByRole('button', { name: 'Key-Value Edit' })).toHaveClass(/ak-mode-toggle-key-value/);
    const formDataText = app.request.getByRole('textbox', { name: 'Form data bulk edit' });
    await formDataText.fill('name: Ada\nbio: one:two');
    await app.requestPanel.getByRole('button', { name: 'Key-Value Edit' }).click();
    await expect(app.requestPanel.locator('.form-data-row input[placeholder="Key"]:visible').first()).toHaveValue('name');
    await expect(app.requestPanel.locator('.form-data-row input[placeholder="Value"]:visible').nth(1)).toHaveValue('one:two');

    const uploadRow = app.requestPanel.locator('.form-data-row:visible').nth(2);
    await uploadRow.locator('input[placeholder="Key"]').fill('upload');
    await uploadRow.locator('.form-data-type-dropdown').click();
    await app.page.getByRole('option', { name: 'File', exact: true }).click();
    await app.requestPanel.getByRole('button', { name: 'Bulk Edit' }).click();
    await expect(formDataText).toHaveValue('name: Ada\nbio: one:two');
    await formDataText.fill('name: Ada\nbio: one:two\ncaption: kept');
    await app.requestPanel.getByRole('button', { name: 'Key-Value Edit' }).click();
    await expect(app.requestPanel.getByRole('button', { name: /Select File/ })).toBeVisible();

    await app.selectBodyType('x-www-form-urlencoded');
    await expectValueColumnAligned('input[placeholder="Value"]');
    await expect(app.requestPanel.locator('.ak-key-value-bulk-edit-button:visible')).toHaveClass(/ak-mode-toggle-bulk/);
    await app.requestPanel.getByRole('button', { name: 'Bulk Edit' }).click();
    await expect(app.requestPanel.getByRole('button', { name: 'Key-Value Edit' })).toHaveClass(/ak-mode-toggle-key-value/);
    const urlencodedText = app.request.getByRole('textbox', { name: 'URL-encoded bulk edit' });
    await urlencodedText.fill('grant_type: password\nscope: a:b');
    await app.requestPanel.getByRole('button', { name: 'Key-Value Edit' }).click();
    await expect(app.requestPanel.locator('input[placeholder="Key"]:visible').first()).toHaveValue('grant_type');
    await expect(app.requestPanel.locator('input[placeholder="Value"]:visible').nth(1)).toHaveValue('a:b');
  });

  test('keeps Ace shortcuts and lets ApiKit shortcuts through', async ({ app, page }) => {
    await editor.setDoc('{"a": 1}|');
    await page.keyboard.press('Control+/');
    expect(await editor.value()).toBe('// {"a": 1}');
    await page.keyboard.press('Control+/');
    await page.keyboard.press('Control+Shift+D');
    expect(await editor.value()).toBe('{"a": 1}\n{"a": 1}');

    const isDark = () => page.evaluate(() => document.documentElement.classList.contains('p-dark'));
    await page.keyboard.press('Control+Alt+D');
    expect(await isDark()).toBe(true);
    await page.keyboard.press('F1');
    const dialog = page.locator('.p-dialog:visible');
    await expect(dialog).toContainText('Keyboard Shortcuts');
    await expect(dialog).toContainText('Duplicate line or selection');
    expect(await editor.value()).toBe('{"a": 1}\n{"a": 1}');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // 选中集合树中的项时，切换主题不会复制它
    await app.run(() => window.__store('collections').createCollection('Theme'));
    const tree = page.locator('.p-tree').first();
    await tree.getByText('Theme', { exact: true }).click();
    await page.keyboard.press('Control+Alt+D');
    expect(await isDark()).toBe(false);
    await expect(tree.locator('.p-tree-node-content')).toHaveCount(1);
  });

  test('closes brackets and indents new lines', async ({ page }) => {
    await editor.setDoc('|');
    await page.keyboard.type('{');
    await page.keyboard.press('Enter');
    await page.keyboard.type('"a": [');
    expect(await editor.value()).toBe('{\n  "a": []\n}');
  });

  test('suggests variables after {{ and inserts the chosen one', async ({ page }) => {
    await editor.setDoc('{"auth": "|"}');
    await page.keyboard.type('{{to');
    await expect(page.locator('.ak-hint-label')).toHaveText(['token']);
    await expect(page.locator('.ak-hint-detail')).toHaveText(['= abc123']);
    await page.keyboard.press('Enter');
    await expect(page.locator('.ak-hints')).toHaveCount(0);
    await page.keyboard.type('X');
    expect(await editor.value()).toBe('{"auth": "{{token}}X"}');

    // 内置变量排在前面，方向键选择
    await editor.setDoc('{"t": |}');
    await page.keyboard.type('{{');
    const labels = page.locator('.ak-hint-label');
    await expect(labels.first()).toHaveText('$timestamp');
    await expect(labels.last()).toHaveText('token');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    expect(await editor.value()).toBe('{"t": {{$isoTimestamp}}}');
  });

  test('colours defined and undefined variables and shows values on hover', async ({ app, page }) => {
    await editor.setDoc('{"a": "{{token}}", "u": "{{missing}}", "b": {{token}}}|');
    const valid = app.request.locator('.ace_template.ace_valid');
    await expect(valid).toHaveCount(2);
    await expect(app.request.locator('.ace_template.ace_invalid')).toHaveCount(1);
    // Ace 的文字层不接收鼠标事件，按位置移动鼠标
    const box = await valid.first().boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(page.locator('.ak-var-hover-tip')).toHaveText('token = abc123');
  });

  test('shows parameter help for functions and closes it with Esc', async ({ page }) => {
    await editor.setDoc('{"s": "|"}');
    await page.keyboard.type('{{$sequence(');
    await expect(page.getByText('$sequence Parameters')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('$sequence Parameters')).toBeHidden();
  });

  test('keeps undo history after Beautify and syncs the request', async ({ app, page }) => {
    const compact = '{"a":1,"b":[1,2],"c":{"d":"{{token}}"}}';
    await editor.setDoc(compact + '|');
    await app.request.getByRole('button', { name: 'Beautify' }).click();
    await expect.poll(async () => (await editor.value()).split('\n').length).toBe(10);
    // 编辑内容同步到请求（防抖后写入 store 中的草稿）
    await expect.poll(() => app.run(() => {
      const store = window.__store('requests');
      const id = window.__store('appState').openRequests[0];
      return store.requests.get(id)?.body?.raw;
    })).toContain('"c": {');
    await page.keyboard.press('Control+z');
    expect(await editor.value()).toBe(compact);
  });

  test('opens the ApiKit search box on Ctrl+F and highlights matches', async ({ app, page }) => {
    await editor.setDoc('{"auth": "a", "name": "abc"}|');
    await page.keyboard.press('Control+f');
    await expect(page.locator('input:focus')).toHaveAttribute('placeholder', 'Search...');
    await page.keyboard.type('a');
    await expect(app.request.locator('.ak-search-match, .ak-search-match-current')).toHaveCount(4);
    await expect(app.request.locator('.ak-search-match-current')).toHaveCount(1);
  });

  test('focuses the search box of the current request when several are open', async ({ app, page }) => {
    await editor.setDoc('{"a": 1}|');
    await page.keyboard.press('Control+f');
    await expect(page.locator('input:focus')).toHaveAttribute('placeholder', 'Search...');

    await app.newRequest();
    await app.selectBodyType('json');
    const second = new AceEditorHandle(page, app.request.locator('.json-editor-container'));
    await second.waitReady();
    await second.setDoc('{"bb": 2}|');
    await page.keyboard.press('Control+f');
    await expect(app.request.getByPlaceholder('Search...')).toBeFocused();
    await page.keyboard.type('b');
    await expect(app.request.getByPlaceholder('Search...')).toHaveValue('b');
    await expect(app.request.locator('.ak-search-match, .ak-search-match-current')).toHaveCount(2);
  });

  test('searches with regular expressions that can match empty text', async ({ app, page }) => {
    await editor.setDoc('{"a": "baab"}|');
    await page.keyboard.press('Control+f');
    await app.request.getByTitle('Use regular expression').click();
    await app.request.getByPlaceholder('Search...').fill('a*');
    await expect(app.request.locator('.ak-search-match, .ak-search-match-current')).toHaveCount(2);
    await app.request.getByPlaceholder('Search...').fill('^');
    await expect(app.request.locator('.ak-search-match, .ak-search-match-current')).toHaveCount(0);
  });

  test('keeps Chinese IME input, punctuation and the first character after focus', async ({ app, page }) => {
    await editor.setDoc('{"cn": "|"}');
    await imeType(page, 'nihao', '你好');
    await imeType(page, 'shijie', '世界');
    await page.keyboard.insertText('，。');
    await imeType(page, 'ceshi', '测试');
    expect(await editor.value()).toBe('{"cn": "你好世界，。测试"}');
    await expect(page.locator('.ak-hints')).toHaveCount(0);

    await app.requestTab('Params');
    await app.requestTab('Body');
    await editor.setDoc('|');
    await imeType(page, 'zhong', '中');
    await imeType(page, 'wen', '文');
    expect(await editor.value()).toBe('中文');

    // 在 {{ 中用输入法：组字期间不弹出补全
    await editor.setDoc('{"v": "|"}');
    await page.keyboard.type('{{');
    await imeType(page, 'bianliang', '变量');
    expect(await editor.value()).toBe('{"v": "{{变量"}');
  });

  test('replaces the selection when typing with a Chinese IME', async ({ page }) => {
    const selectOld = () => editor.host.evaluate((el: any) => el.env.editor.selection.selectWordRight());
    await editor.setDoc('{"cn": "|old"}');
    await selectOld();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: 'zh', selectionStart: 2, selectionEnd: 2 });
    // 组字一开始就删掉选中内容，组字文字不会写进文档、盖在选中文字上
    expect(await editor.value()).toBe('{"cn": ""}');
    await cdp.send('Input.insertText', { text: '中文' });
    expect(await editor.value()).toBe('{"cn": "中文"}');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    expect(await editor.value()).toBe('{"cn": "old"}');

    // Windows 上输入法按键先触发 keyCode 229 的 keydown，此时就删掉选中内容
    await editor.setDoc('{"cn": "|old"}');
    await selectOld();
    await editor.host.locator('textarea').dispatchEvent('keydown', { keyCode: 229, key: 'Process' });
    expect(await editor.value()).toBe('{"cn": ""}');
    await cdp.send('Input.imeSetComposition', { text: 'wen', selectionStart: 3, selectionEnd: 3 });
    await cdp.send('Input.insertText', { text: '文' });
    await cdp.detach();
    expect(await editor.value()).toBe('{"cn": "文"}');
  });

  test('closes XML tags and expands Enter between them', async ({ app, page }) => {
    await app.selectBodyType('xml');
    await editor.setDoc('|');
    await page.keyboard.type('<root>');
    expect(await editor.value()).toBe('<root></root>');
    await page.keyboard.press('Enter');
    expect(await editor.value()).toBe('<root>\n  \n</root>');
    await page.keyboard.type('<item a="1">v');
    expect(await editor.value()).toBe('<root>\n  <item a="1">v</item>\n</root>');
  });
});

test.describe('response viewer', () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
    await app.newRequest();
    await app.url.fill('https://api.example.com/items');
  });

  test('shows JSON responses with folding, search and dark mode', async ({ app, page }) => {
    await app.setMockResponse({ body: JSON.stringify({ id: 42, name: 'ApiKit', tags: ['a', 'b'], nested: { ok: true, n: null } }, null, 2) });
    await app.request.getByRole('button', { name: 'Send', exact: true }).click();
    const viewer = app.request.locator('.code-editor-container').first();
    await expect(viewer.locator('.ace_line').first()).toHaveText('{');
    await expect(viewer.locator('.ace_variable', { hasText: '"name"' })).toHaveCount(1);
    await expect(viewer.locator('.ace_constant.ace_language.ace_null')).toHaveCount(1);
    await expect(viewer.locator('.ace_fold-widget')).toHaveCount(3);

    await viewer.click({ position: { x: 200, y: 40 } });
    // 只读查看器中按键不弹出提示
    await page.keyboard.type('x');
    await expect(page.getByText('Editing is disabled')).toHaveCount(0);
    await page.keyboard.press('Control+f');
    await expect(page.locator('input:focus')).toHaveAttribute('placeholder', 'Search...');
    await page.keyboard.type('a');
    await expect(viewer.locator('.ak-search-match, .ak-search-match-current')).toHaveCount(4);
    await page.keyboard.press('Escape');

    await page.evaluate(() => document.documentElement.classList.add('p-dark'));
    await expect(viewer.locator('.ace_editor')).toHaveClass(/ace-apikit-dark/);
  });

  test('focuses the response search box of the current request when several are open', async ({ app, page }) => {
    await app.setMockResponse({ body: '{"a": 1}' });
    await app.request.getByRole('button', { name: 'Send', exact: true }).click();
    await app.request.locator('.code-editor-container').first().click({ position: { x: 100, y: 10 } });
    await page.keyboard.press('Control+f');
    await expect(page.locator('input:focus')).toHaveAttribute('placeholder', 'Search...');

    await app.newRequest();
    await app.url.fill('https://api.example.com/other');
    await app.setMockResponse({ body: '{"bb": 2}' });
    await app.request.getByRole('button', { name: 'Send', exact: true }).click();
    await app.request.locator('.code-editor-container').first().click({ position: { x: 100, y: 10 } });
    await page.keyboard.press('Control+f');
    await expect(app.request.getByPlaceholder('Search...')).toBeFocused();
    await page.keyboard.type('b');
    await expect(app.request.getByPlaceholder('Search...')).toHaveValue('b');
  });

  test('shows XML responses and large responses quickly', async ({ app }) => {
    await app.setMockResponse({ contentType: 'application/xml', body: '<?xml version="1.0"?>\n<root id="1">\n  <item>hello</item>\n</root>' });
    await app.request.getByRole('button', { name: 'Send', exact: true }).click();
    const viewer = app.request.locator('.code-editor-container').first();
    await expect(viewer.locator('.ace_meta.ace_tag.ace_tag-name', { hasText: 'item' }).first()).toBeVisible();

    const items = Array.from({ length: 12000 }, (_, i) => ({ id: i, name: `item ${i}` }));
    await app.setMockResponse({ body: JSON.stringify(items) });
    const started = Date.now();
    await app.request.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(viewer.getByText('"item 0"')).toBeVisible();
    expect(Date.now() - started).toBeLessThan(5000);
    // 只渲染可见的行
    expect(await viewer.locator('.ace_line').count()).toBeLessThan(200);
  });

  test('shows request and response bodies in the Console', async ({ app, page }) => {
    await app.setMockResponse({ body: '{"small":true}' });
    await app.request.getByRole('button', { name: 'Send', exact: true }).click();
    await page.locator('footer').getByRole('tab', { name: 'Console' }).click();
    await page.locator('span.flex-1.truncate:visible', { hasText: 'api.example.com/items' }).first().click();
    const body = page.locator('.code-editor-container-auto-height');
    await expect(body).toHaveCount(1);
    await expect(body).toContainText('{"small":true}');

    // 格式化按钮在格式化和原文之间切换，只改变显示
    await expect(body.locator('.ace_line')).toHaveCount(1);
    await page.getByRole('button', { name: 'Format response body' }).click();
    await expect(body.locator('.ace_line')).toHaveCount(3);
    await expect(body.locator('.ace_line').nth(1)).toHaveText('  "small": true');
    await page.getByRole('button', { name: 'Show original response body' }).click();
    await expect(body.locator('.ace_line')).toHaveCount(1);
    await expect(body).toContainText('{"small":true}');
  });

  test('stores log bodies in their own files and reads them when expanding or reopening', async ({ app, page }) => {
    await app.request.locator('.p-select-label, .p-dropdown-label').first().click();
    await page.getByRole('option', { name: 'POST', exact: true }).click();
    await app.selectBodyType('json');
    const editor = new AceEditorHandle(page, app.request.locator('.json-editor-container'));
    await editor.waitReady();
    await editor.setDoc('{"order":7}|');
    await app.setMockResponse({ body: '{"created":true}' });
    await app.request.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(app.request.locator('.code-editor-container').first()).toContainText('"created"');

    // 索引中只有摘要，body 在每条日志自己的文件中
    await app.run(() => Promise.all([window.__store('consoleLogs').flush(), window.__store('history').flush()]));
    const stored = await app.run(() => {
      const files = Object.fromEntries(window.__files);
      const pick = (dir: string) => Object.keys(files).filter(path => path.startsWith(`/tmp/apikit/history/${dir}/`)).map(path => JSON.parse(files[path]));
      return {
        consoleIndex: files['/tmp/apikit/history/console-logs.json'],
        historyIndex: files['/tmp/apikit/history/history.json'],
        consoleBodies: pick('console-bodies'),
        historyBodies: pick('history-bodies'),
      };
    });
    expect(stored.consoleIndex).not.toContain('created');
    expect(stored.historyIndex).not.toContain('order');
    expect(stored.consoleBodies).toEqual([{ requestBody: '{"order":7}', responseBody: '{"created":true}' }]);
    expect(stored.historyBodies).toEqual([{ body: '{"order":7}' }]);

    await page.locator('footer').getByRole('tab', { name: 'Console' }).click();
    await page.locator('span.flex-1.truncate:visible', { hasText: 'api.example.com/items' }).first().click();
    const bodies = page.locator('.code-editor-container-auto-height');
    await expect(bodies).toHaveCount(2);
    await expect(bodies.first()).toContainText('{"order":7}');
    await expect(bodies.last()).toContainText('{"created":true}');

    // 从 History 重新打开请求时读取请求体
    await page.locator('aside.sidebar').getByRole('tab', { name: 'History' }).click();
    await page.locator('aside.sidebar').getByText('https://api.example.com/items').first().dblclick();
    await expect(app.url).toHaveValue('https://api.example.com/items');
    await app.requestTab('Body');
    await expect(app.requestPanel.locator('.ace_content')).toContainText('{"order":7}');
  });
});
