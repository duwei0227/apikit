// 工具栏导入导出、环境和变量对话框，以及按需加载的模块（cURL 解析、工作流引擎、MCP 工具）。

import { expect, test } from './fixtures/app';

const REQUEST = { params: [], headers: [], body: { type: 'none', raw: '', formData: [], urlencoded: [] }, auth: { type: 'none' } };

test.beforeEach(async ({ app }) => {
  await app.open();
});

test('exports collections and workflows and imports cURL', async ({ app, page }) => {
  await app.run(async (request) => {
    const cols = window.__store('collections');
    const c = await cols.createCollection('Shop API');
    const r = { ...request, id: 'req-1', name: 'List orders', method: 'GET', url: 'https://example.com/orders', collectionId: c.id };
    await window.__store('requests').saveRequest(r, true);
    await cols.addRequestReference(c.id, r.id, r.name, r.method, r.url);
    await window.__store('workflows').saveWorkflow({
      id: 'wf-1', name: 'Checkout flow', version: 1, createdAt: '', updatedAt: '',
      steps: [{ id: 's1', type: 'request', name: 'Orders', enabled: true, requestSource: 'reference', requestId: 'req-1' }],
    });
  }, REQUEST);

  await page.locator('.toolbar').getByText('Export', { exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('List orders')).toBeVisible();
  await dialog.getByText('Select all').click();
  await expect(dialog.locator('.tabular-nums')).toContainText('1');
  await dialog.getByRole('tab', { name: /Workflows/ }).click();
  await dialog.getByText('Checkout flow').click();
  await expect(dialog.locator('.transfer-meta').first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);

  // cURL 解析器按需加载
  await page.locator('.toolbar').getByText('Import', { exact: true }).click();
  await dialog.getByText('cURL', { exact: true }).click();
  await dialog.locator('textarea').fill("curl -X PUT 'https://httpbin.org/put?id=7' -H 'X-A: 1'");
  await dialog.getByRole('button', { name: 'Import' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(app.url).toHaveValue('https://httpbin.org/put?id=7');
  await expect(app.request.locator('.p-select-label, .p-dropdown-label').first()).toHaveText('PUT');
  expect(await app.params()).toEqual(['id=7', '=']);
});

test('creates, edits and copies environments and shows variables', async ({ app, page }) => {
  const dialog = page.locator('.p-dialog').last();
  const environments = () => app.run(() => window.__store('environments').environments.map((e: any) => `${e.name}:${e.variables.length}`));

  await page.locator('.environment-manager button').nth(0).click();
  await dialog.getByRole('button', { name: 'Add' }).click();
  await dialog.getByPlaceholder('Enter environment name').fill('Staging');
  await dialog.getByPlaceholder('Variable').first().fill('baseUrl');
  await dialog.getByPlaceholder('Value').first().fill('https://staging.example.com');
  // 输入最后一行时自动追加空行
  await expect(dialog.getByPlaceholder('Variable')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect.poll(environments).toEqual(['Staging:1']);

  await dialog.getByText('Staging').click();
  await expect(dialog.getByPlaceholder('Value').first()).toHaveValue('https://staging.example.com');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await dialog.locator('button[title=Copy]').click();
  await expect.poll(environments).toEqual(['Staging:1', 'Staging (Copy):1']);
  await dialog.locator('.p-dialog-footer button', { hasText: 'Close' }).click();

  // 变量查看：当前环境、全局变量和请求中用到的序列
  await app.run(async () => {
    const env = window.__store('environments');
    await env.setActiveEnvironment(env.environments.find((e: any) => e.name === 'Staging').id);
    env.setGlobalVariable('token', 'abc', true, 'auth token');
  });
  await app.newRequest();
  await app.url.fill('{{baseUrl}}/orders/{{$sequence(name=orderNo)}}');
  await page.locator('.environment-manager button').nth(1).click();
  await expect(dialog).toContainText('https://staging.example.com');
  await expect(dialog).toContainText('auth token');

  await dialog.locator('button[title=Edit]').first().click({ force: true });
  await dialog.getByPlaceholder('Description (optional)').fill('changed');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => app.run(() => window.__store('environments').globalVariables.map((v: any) => [v.key, v.description])))
    .toEqual([['token', 'changed']]);

  await dialog.locator('button[title="Edit Sequence"]').first().click({ force: true });
  await expect(dialog.locator('input[disabled]')).toHaveValue('orderNo');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => app.run(() => window.__store('sequences').getAllSequences().map((s: any) => s.name))).toEqual(['orderNo']);
  await expect(page.locator('.p-dialog-title', { hasText: 'Edit Sequence' })).toHaveCount(0);
});

test('previews the first value of sequences that have not been used yet', async ({ app, page }) => {
  await app.newRequest();
  await app.url.fill('https://example.com/{{$sequence(name=invoice, start=100, padding=5)}}');
  // 编辑内容防抖后才同步到当前请求
  await app.blurInputs();
  await page.locator('.environment-manager button').nth(1).click();
  const dialog = page.locator('.p-dialog').last();
  await expect(dialog).toContainText('invoice');
  await expect(dialog).toContainText('will start at 100');
});

test('explains how sequences are created when there are none', async ({ page }) => {
  await page.locator('.environment-manager button').nth(2).click();
  await expect(page.locator('.p-dialog').last()).toContainText('when you use {{$sequence}} in your requests');
});

test('runs workflows and answers MCP calls with lazily loaded modules', async ({ app }) => {
  const run = await app.run(async () => {
    const workflows = window.__store('workflows');
    await workflows.runWorkflow({
      id: 'wf-x', name: 'Lazy run', version: 1, createdAt: '', updatedAt: '',
      steps: [{ id: 's1', type: 'for', name: 'Loop', enabled: true, iterations: 2, childSteps: [] }],
    });
    const logs = workflows.getWorkflowLogs('wf-x');
    return { running: workflows.isRunning, summary: logs.find((l: any) => l.stepType === 'workflow')?.status };
  });
  expect(run).toEqual({ running: false, summary: 'completed' });

  await app.run(() => window.__store('mcp').setEnabled(true));
  const start = await app.run(() => window.__invokes.find(([cmd]) => cmd === 'mcp_start')?.[1]);
  expect(start.tools.length).toBeGreaterThan(10);
  expect(start.confirmTools).toContain('send_request');

  await app.run(() => window.__store('collections').createCollection('Lazy Shop'));
  await app.run(() => {
    window.__emitTauriEvent('mcp://call', { id: 'call-1', name: 'list_collections', arguments: {} });
    window.__emitTauriEvent('mcp://call', { id: 'call-2', name: 'update_request', arguments: { requestId: 'missing', name: 'x' } });
  });
  await expect.poll(() => app.run(() => window.__invokes.filter(([cmd]) => cmd === 'mcp_respond')
    .map(([, args]) => [args.id, !!args.result.isError, /Lazy Shop/.test(args.result.content[0].text)])))
    .toEqual([['call-1', false, true], ['call-2', true, false]]);
});

test('keeps MCP edits to open requests and workflows as unsaved edits', async ({ app, page }) => {
  await app.run(() => window.__store('mcp').setEnabled(true));
  const mcp = async (id: string, name: string, args: Record<string, unknown>) => {
    await app.run(([id, name, args]) => window.__emitTauriEvent('mcp://call', { id, name, arguments: args }), [id, name, args] as const);
    await expect.poll(() => app.run((id) => window.__invokes.some(([cmd, args]) => cmd === 'mcp_respond' && args.id === id), id)).toBe(true);
    return JSON.parse(await app.run((id) => window.__invokes.find(([cmd, args]) => cmd === 'mcp_respond' && args.id === id)![1].result.content[0].text, id));
  };
  const collection = await mcp('c1', 'create_collection', { name: 'AI Shop' });
  const request = await mcp('c2', 'create_request', { collectionId: collection.id, name: 'Ping', url: 'https://a.example.com/ping' });

  const tree = page.locator('.p-tree').first();
  await tree.locator('.p-tree-node-toggle-button[data-p-leaf=false]').first().click();
  await tree.getByText('Ping', { exact: true }).click();
  await expect(app.url).toHaveValue('https://a.example.com/ping');

  const activeTab = page.locator('.content-tabs [data-content-tab-index][data-p-active=true]');
  await expect(activeTab.locator('.bg-orange-500')).toHaveCount(0);
  const updated = await mcp('c3', 'update_request', { requestId: request.id, url: 'https://b.example.com/ping' });
  expect(updated.unsavedEdits).toBe(true);
  await expect(app.url).toHaveValue('https://b.example.com/ping');
  await expect(activeTab.locator('.bg-orange-500')).toHaveCount(1);
  expect(await app.run((id) => window.__store('collections').collections[0].requests.find((r: any) => r.id === id).url, request.id))
    .toBe('https://a.example.com/ping');

  await page.locator('button[title="New Workflow"]').click();
  await expect(activeTab).toContainText('Workflow 1');
  const workflowId = await app.run(() => window.__store('workflows').workflows[0].id);
  await mcp('c4', 'update_workflow', { workflowId, name: 'AI Flow' });
  await expect(activeTab).toContainText('AI Flow');
  await expect(activeTab.locator('.bg-orange-500')).toHaveCount(1);
  expect(await app.run(() => window.__store('workflows').workflows[0].name)).toBe('Workflow 1');
});

test('handles shortcuts with Caps Lock on', async ({ app, page }) => {
  // 大写锁定时字母键的 key 为大写（按住 Shift 时反而为小写）
  const press = (key: string, init: KeyboardEventInit = {}) => app.run(([key, init]) => {
    const target = document.activeElement || document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', { key, code: `Key${key.toUpperCase()}`, ctrlKey: true, bubbles: true, cancelable: true, ...init }));
  }, [key, init] as const);
  const dialog = page.locator('.p-dialog:visible');

  await press('N');
  await expect(dialog).toContainText('Create New');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await app.newRequest();
  await app.url.click();
  await press('S');
  await expect(dialog).toContainText('Save Request');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  const isDark = () => page.evaluate(() => document.documentElement.classList.contains('p-dark'));
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await press('D', { altKey: true });
  expect(await isDark()).toBe(true);

  await app.run(() => window.__store('collections').createCollection('Caps'));
  const tree = page.locator('.p-tree').first();
  await tree.getByText('Caps', { exact: true }).click();
  await press('D');
  await expect(tree.getByText('Caps (Copy)', { exact: true })).toBeVisible();
});

test('keeps the theme button in sync with the Ctrl+Alt+D shortcut', async ({ page }) => {
  const isDark = () => page.evaluate(() => document.documentElement.classList.contains('p-dark'));
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('Control+Alt+D');
  expect(await isDark()).toBe(true);
  await expect(page.getByTitle('Switch to Light Mode')).toBeVisible();
  // 再点标题栏的按钮应切回浅色
  await page.getByTitle('Switch to Light Mode').click();
  expect(await isDark()).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('light');
});

test('extracts a response header into a global variable', async ({ app, page }) => {
  await app.newRequest();
  await app.url.fill('https://example.com/session');
  await app.requestTab('Tests');
  const addVariable = app.request.getByRole('button', { name: 'Add Variable' });
  if (!(await addVariable.isVisible())) await app.request.getByText('Global Variable Settings').click();
  await addVariable.click();

  // 新增的一行在最后
  await app.request.getByPlaceholder('token', { exact: true }).last().fill('ctype');
  await app.request.getByPlaceholder('$.data.token').last().locator('xpath=../..').locator('.p-select').click();
  await page.locator('.p-select-option', { hasText: 'Response Header' }).click();
  await app.request.getByPlaceholder('x-session').fill('Content-Type');

  await app.request.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => app.run(() => window.__store('environments').globalVariables.find((v: any) => v.key === 'ctype')?.value))
    .toBe('application/json');
});

test('shows custom token events as thinking and the result events separately', async ({ app }) => {
  await app.newRequest();
  await app.url.fill('https://example.com/review/stream');
  const event = (name: string, data: unknown) => `event:${name}\ndata:${JSON.stringify(data)}\n\n`;
  await app.setMockResponse({
    contentType: 'text/event-stream',
    body: event('token', { type: 'token', content: '先核对预算科目', data: null })
      + event('result', { type: 'result', content: null, data: { suggestAction: 'APPROVE' } })
      + event('fill', { type: 'fill', content: '同意报销。', data: null })
      + event('done', { type: 'done', content: null, data: null }),
  });
  await app.request.getByRole('button', { name: 'Send', exact: true }).click();

  // 结果到达后思考内容折叠成一行，result 显示为 JSON，fill 显示为文本
  await expect(app.request.getByRole('button', { name: /Thinking/ })).toBeVisible();
  await expect(app.request.getByText('先核对预算科目')).toBeHidden();
  await expect(app.request.getByText('同意报销。')).toBeVisible();
  await expect(app.request.locator('.ace_content', { hasText: 'APPROVE' })).toBeVisible();
});

test('streams custom token text and keeps Thinking open while it continues after a result', async ({ app, page }) => {
  await app.newRequest();
  await app.url.fill('https://example.com/review/stream');
  const event = (name: string, data: unknown) => `event:${name}\ndata:${JSON.stringify(data)}\n\n`;
  await app.setMockResponse({ contentType: 'text/event-stream', body: '', live: true });
  await app.request.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(() => window.__liveStream !== null);

  // 还没有结果事件时 token 作为回答边收边显示
  await app.pushStream(event('token', { type: 'token', content: '先核对', data: null }));
  await expect(app.request.getByText('先核对')).toBeVisible();
  await expect(app.request.getByRole('button', { name: /Thinking/ })).toBeHidden();

  // 结果事件之后 token 继续输出：Thinking 保持展开，显示最新的文本
  await app.pushStream(event('status', { type: 'status', content: '分析中', data: null }));
  await app.pushStream(event('token', { type: 'token', content: '预算科目', data: null }));
  await expect(app.request.getByText('先核对预算科目')).toBeVisible();
  await expect(app.request.getByText('分析中')).toBeVisible();

  // 流结束后 Thinking 折叠
  await app.pushStream(event('fill', { type: 'fill', content: '同意报销。', data: null }));
  await app.endStream();
  await expect(app.request.getByText('同意报销。')).toBeVisible();
  await expect(app.request.getByText('先核对预算科目')).toBeHidden();
});

test('collapses Thinking again for the next streamed response', async ({ app }) => {
  await app.newRequest();
  await app.url.fill('https://example.com/chat/stream');
  const chunk = (delta: Record<string, string>) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
  await app.setMockResponse({
    contentType: 'text/event-stream',
    body: chunk({ reasoning_content: '先想一想' }) + chunk({ content: '你好' }) + 'data: [DONE]\n\n',
  });
  const send = app.request.getByRole('button', { name: 'Send', exact: true });
  await send.click();
  await expect(app.request.getByText('你好')).toBeVisible();

  // 手动展开的 Thinking 只对这次响应有效
  await app.request.getByRole('button', { name: /Thinking/ }).click();
  await expect(app.request.getByText('先想一想')).toBeVisible();
  await send.click();
  await expect(app.request.getByRole('button', { name: /Thinking/ })).toBeVisible();
  await expect(app.request.getByText('先想一想')).toBeHidden();
});

test('asks before every MCP deletion and closes the deleted request tab', async ({ app, page }) => {
  await app.run(() => window.__store('mcp').setEnabled(true));
  const mcpCall = (id: string, name: string, args: Record<string, unknown>) =>
    app.run(([id, name, args]) => window.__emitTauriEvent('mcp://call', { id, name, arguments: args }), [id, name, args] as const);
  const mcpResult = async (id: string) => {
    await expect.poll(() => app.run((id) => window.__invokes.some(([cmd, args]) => cmd === 'mcp_respond' && args.id === id), id)).toBe(true);
    return JSON.parse(await app.run((id) => window.__invokes.find(([cmd, args]) => cmd === 'mcp_respond' && args.id === id)![1].result.content[0].text, id));
  };
  await mcpCall('d1', 'create_collection', { name: 'Temp' });
  const collection = await mcpResult('d1');
  await mcpCall('d2', 'create_request', { collectionId: collection.id, name: 'Scratch', url: 'https://example.com/scratch' });
  const request = await mcpResult('d2');

  const tree = page.locator('.p-tree').first();
  await tree.locator('.p-tree-node-toggle-button[data-p-leaf=false]').first().click();
  await tree.getByText('Scratch', { exact: true }).click();
  await expect(app.url).toHaveValue('https://example.com/scratch');

  // 即使已选择"全部允许"，删除仍然逐个确认
  await app.run(() => { window.__store('mcp').allowAllExecute = true; });
  await mcpCall('d3', 'delete_request', { requestId: request.id });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('AI wants to delete a request');
  await expect(dialog).toContainText('GET Scratch · Temp');
  await expect(dialog.getByRole('button', { name: 'Allow All This Session' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Delete' }).click();

  expect(await mcpResult('d3')).toMatchObject({ deleted: { requestId: request.id } });
  await expect(tree.getByText('Scratch', { exact: true })).toHaveCount(0);
  await expect(page.locator('.content-tabs [data-content-tab-index]', { hasText: 'Scratch' })).toHaveCount(0);

  // 工具列表中删除工具单独分组
  await app.run(() => window.__store('mcp').openDialog());
  await page.getByText(/^Available tools/).click();
  const group = (label: string) => page.locator('.mcp-details').getByText(label, { exact: true }).locator('xpath=..');
  const deleteGroup = group('Delete (asks you every time)');
  await expect(deleteGroup.locator('code')).toHaveText(['delete_request', 'delete_folder', 'delete_collection', 'delete_workflow']);
  await expect(group('Create and edit').locator('code', { hasText: 'delete_' })).toHaveCount(0);
});

test('stops the MCP and mock servers before restarting to apply an update', async ({ app, page }) => {
  await app.run(() => {
    window.__invokeResults['plugin:updater|check'] = { rid: 1, currentVersion: '0.4.1', version: '9.0.0', date: null, body: '', rawJson: {} };
  });
  await page.locator('button[title="Help"]').click();
  await page.getByRole('menuitem', { name: 'Check For Update' }).click();
  await page.getByRole('button', { name: 'Install & Restart' }).click();

  // 新进程启动时要用同样的端口：先停止服务，再重启
  const commands = () => app.run(() => window.__invokes.map(([cmd]) => cmd)
    .filter(cmd => cmd === 'stop_local_servers' || cmd === 'plugin:process|restart'));
  await expect.poll(commands).toEqual(['stop_local_servers', 'plugin:process|restart']);
});

test('opens the documentation from the Help menu', async ({ app, page }) => {
  await page.locator('button[title="Help"]').click();
  await page.getByRole('menuitem', { name: 'Documentation' }).click();
  const opened = () => app.run(() => window.__invokes.filter(([cmd]) => cmd === 'plugin:opener|open_url').map(([, args]) => args.url));
  // 测试浏览器的语言为英文
  await expect.poll(opened).toEqual(['https://duwei0227.github.io/apikit/en/']);
});

test('opens and copies the documentation and GitHub links in About', async ({ app, page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('button[title="Help"]').click();
  await page.getByRole('menuitem', { name: 'About ApiKit' }).click();
  const links = page.getByTestId('about-link');
  // 测试浏览器的语言为英文
  await expect(links).toHaveText([/Documentation\s*duwei0227\.github\.io\/apikit\/en/, /GitHub\s*github\.com\/duwei0227\/apikit/]);

  await links.nth(0).getByRole('link').click();
  await links.nth(1).getByRole('link').click();
  const opened = () => app.run(() => window.__invokes.filter(([cmd]) => cmd === 'plugin:opener|open_url').map(([, args]) => args.url));
  await expect.poll(opened).toEqual(['https://duwei0227.github.io/apikit/en/', 'https://github.com/duwei0227/apikit']);

  await links.nth(0).getByRole('button', { name: 'Copy Documentation link' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('https://duwei0227.github.io/apikit/en/');
});

test.describe('edit menu', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('selects all, cuts and pastes in an input from the right-click menu', async ({ app, page }) => {
    await app.newRequest();
    await app.url.fill('https://example.com/orders');
    const menu = page.locator('.p-contextmenu');
    const choose = async (item: string) => {
      await app.url.click({ button: 'right' });
      await expect(menu.getByText(item, { exact: true })).toBeVisible();
      await expect(menu.locator('.p-contextmenu-item')).toHaveText(['Cut', 'Copy', 'Paste', 'Select All']);
      await menu.getByText(item, { exact: true }).click();
      await expect(menu).toBeHidden();
      // 菜单打开时焦点在菜单上，执行命令前要还给输入框
      await expect(app.url).toBeFocused();
    };

    // 焦点和选区还给输入框后再执行命令
    await choose('Select All');
    await expect.poll(() => app.url.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd]))
      .toEqual([0, 'https://example.com/orders'.length]);

    await choose('Cut');
    await expect(app.url).toHaveValue('');

    await choose('Paste');
    await expect(app.url).toHaveValue('https://example.com/orders');
  });
});

test('newRequest waits for the new tab even when saving the request is slow', async ({ app, page }) => {
  // 新请求先保存再切换页签；让保存时的路径拼接变慢，放大切换前的间隙
  await page.evaluate(() => {
    const internals = (window as any).__TAURI_INTERNALS__;
    const invoke = internals.invoke;
    internals.invoke = async (cmd: string, args: any, options: any) => {
      if (cmd === 'plugin:path|join') await new Promise(resolve => setTimeout(resolve, 300));
      return invoke(cmd, args, options);
    };
  });
  await app.newRequest();
  await app.url.fill('https://example.com/first');
  await app.newRequest();
  // 紧接着输入：应落在新请求上，第一个请求的 URL 不变
  await app.url.fill('https://example.com/second');
  const allUrls = () => page.locator('.http-request').getByPlaceholder('Enter request URL')
    .evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value).sort());
  await expect.poll(allUrls).toEqual(['https://example.com/first', 'https://example.com/second']);
});

test('pressing the MCP status dot in the title bar does not drag the window', async ({ app, page }) => {
  await page.evaluate(() => {
    const internals = (window as any).__TAURI_INTERNALS__;
    const invoke = internals.invoke;
    (window as any).__dragCalls = 0;
    internals.invoke = (cmd: string, args: any, options: any) => {
      if (cmd === 'plugin:window|start_dragging') (window as any).__dragCalls++;
      return invoke(cmd, args, options);
    };
  });
  await app.run(() => { window.__store('mcp').running = true; });
  const dot = page.locator('.navbar .p-overlaybadge .p-badge');
  await expect(dot).toBeVisible();
  await dot.click();
  // 空白处仍可拖动，说明拦截只针对按钮及其状态点
  await page.locator('.navbar h1').click();
  await expect.poll(() => page.evaluate(() => (window as any).__dragCalls)).toBe(1);
});
