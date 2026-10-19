// Mock 服务：新建服务、编辑路由和响应、按规则应答（模拟 Rust 端的 mock://request 事件）、调用记录、模板预览和「Save to Mock」。

import { AceEditorHandle, expect, test, type App } from './fixtures/app';
import type { Page } from '@playwright/test';

async function createService(page: Page, port: string) {
  await page.getByRole('tab', { name: 'Mocks' }).click();
  await page.getByRole('button', { name: 'New Mock Service' }).click();
  const dialog = page.locator('.p-dialog:visible');
  await dialog.getByLabel('Port').fill(port);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.mock-workspace')).toBeVisible();
}

const serviceId = (app: App) => app.run(() => window.__store('mocks').services[0].id as string);

/** 模拟 Rust 端交来一次请求，返回前端的答复 */
async function call(app: App, id: string, path: string, query = '', headers: Array<[string, string]> = []) {
  const service = await serviceId(app);
  await app.run(([id, service, path, query, headers]) => window.__emitTauriEvent('mock://request', {
    id, serviceId: service, method: 'GET', path, query, headers, body: '',
  }), [id, service, path, query, headers] as const);
  await expect.poll(() => app.run((id) => window.__invokes.some(([cmd, args]) => cmd === 'mock_respond' && args.id === id), id)).toBe(true);
  return app.run((id) => window.__invokes.find(([cmd, args]) => cmd === 'mock_respond' && args.id === id)![1].reply, id);
}

const responseBody = (page: Page) => new AceEditorHandle(page, page.locator('.mock-response-editor .json-editor-container'));

test.beforeEach(async ({ app }) => {
  await app.open();
});

test('creates a mock service and answers calls by rules', async ({ app, page }) => {
  await createService(page, '3005');
  const id = await serviceId(app);
  expect(await app.run(() => window.__invokes.find(([cmd]) => cmd === 'mock_start')?.[1])).toEqual({ serviceId: id, port: 3005, cors: true });
  await expect(page.locator('[data-mock-service="Mock Service"]')).toContainText(':3005');

  // 路由和默认响应
  await page.getByRole('button', { name: 'Route', exact: true }).click();
  await page.getByLabel('Path').fill('/orders/:id');
  await page.getByLabel('Path').blur();
  const body = responseBody(page);
  await body.waitReady();
  await body.setDoc('{"id": {{$request.params.id}}, "page": {{$request.query.page ?? 1}}}');

  // 第二个响应：路径参数 id 为 0 时返回 404
  await page.getByRole('button', { name: 'Add response' }).click();
  const editor = page.locator('.mock-response-editor');
  await editor.getByLabel('Response name').fill('Missing');
  await editor.getByLabel('Status').fill('404');
  await editor.getByRole('tab', { name: /^Rules/ }).click();
  await editor.getByRole('button', { name: 'Add rule' }).click();
  await editor.getByLabel('Key').fill('id');
  await editor.getByLabel('Value').fill('0');
  await expect(page.locator('[data-response="Missing"]')).toContainText('path id equals 0');

  await expect.poll(async () => (await call(app, 'c1', '/orders/42', 'page=3')).body).toBe('{"id": 42, "page": 3}');
  expect(await call(app, 'c2', '/orders/0')).toMatchObject({ status: 404, delayMs: 0 });
  expect(await call(app, 'c3', '/orders/0', '', [['X-Mock-Response-Name', 'Success']])).toMatchObject({ status: 200 });
  expect(JSON.parse((await call(app, 'c4', '/refunds')).body)).toEqual({ error: 'No route matches GET /refunds' });

  // 调用记录：列表、详情，追加写入文件
  await page.getByRole('tab', { name: /^Logs/ }).click();
  await expect(page.getByRole('tab', { name: /^Logs/ })).toHaveText('Logs (4 / 100)');
  // 最新的在前：第二条 /orders/0 是按规则返回的 Missing
  await page.locator('[data-log-path="/orders/0"]').last().click();
  await expect(page.locator('.match-banner')).toContainText('response Missing');
  await page.locator('[data-log-path="/refunds"]').click();
  await expect(page.locator('.match-banner')).toContainText('No route matches GET /refunds');
  const logFile = await app.run((id) => window.__files.get(`/tmp/apikit/mocks/_logs/${id}.jsonl`) || '', id);
  expect(logFile.trim().split('\n').map(line => JSON.parse(line).path)).toEqual(['/orders/42', '/orders/0', '/orders/0', '/refunds']);

  // 未匹配的调用可以直接添加路由
  await page.getByRole('button', { name: 'Add Route' }).click();
  await expect(page.locator('[data-route="GET /refunds"]')).toBeVisible();

  // 用记录的调用新建请求
  await page.getByRole('tab', { name: /^Logs/ }).click();
  await page.locator('[data-log-path="/orders/42?page=3"]').click();
  await page.getByRole('button', { name: 'Open as Request' }).click();
  await expect(app.url).toHaveValue('http://127.0.0.1:3005/orders/42?page=3');

  // 定义保存到文件
  await expect.poll(() => app.run((id) => {
    const text = window.__files.get(`/tmp/apikit/mocks/${id}.json`);
    return text ? JSON.parse(text).routes.map((route: any) => `${route.method} ${route.path}`) : [];
  }, id)).toEqual(['GET /orders/:id', 'GET /refunds']);
});

test('copies the route URL, opens it as a request and duplicates it disabled', async ({ app, page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await createService(page, '3008');
  await page.getByRole('button', { name: 'Route', exact: true }).click();
  await page.getByLabel('Path').fill('/orders/{{id}}');
  await page.getByLabel('Path').blur();
  await page.locator('.mock-response-editor').getByLabel('Response name').fill('Paid');

  // 复制完整地址：路径参数换成示例值 1
  await page.getByRole('button', { name: 'Copy URL' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('http://127.0.0.1:3008/orders/1');

  // 复制路由：副本停用、路径加 -copy，并聚焦路径
  await page.getByRole('button', { name: 'Route actions' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate Route' }).click();
  await expect(page.getByLabel('Path')).toHaveValue('/orders/{{id}}-copy');
  await expect(page.getByLabel('Path')).toBeFocused();
  await expect(page.locator('[data-route="GET /orders/{{id}}-copy"]')).toHaveClass(/disabled/);
  await expect.poll(() => app.run(() => window.__store('mocks').services[0].routes
    .map((route: any) => [route.path, route.enabled]))).toEqual([['/orders/{{id}}', true], ['/orders/{{id}}-copy', false]]);

  // 在请求中打开：带上 x-mock-response-name，返回正在编辑的响应
  await page.locator('[data-route="GET /orders/{{id}}"]').click();
  await page.getByRole('button', { name: 'Open as Request' }).click();
  await expect(app.url).toHaveValue('http://127.0.0.1:3008/orders/1');
  const headers = await app.run(() => [...window.__store('requests').requests.values()]
    .find((request: any) => request.url === 'http://127.0.0.1:3008/orders/1')?.headers
    .filter((header: any) => header.key).map((header: any) => [header.key, header.value]));
  expect(headers).toEqual([['x-mock-response-name', 'Paid']]);
});

test('previews path parameters when the preview request is a full URL', async ({ page }) => {
  await createService(page, '3009');
  await page.getByRole('button', { name: 'Route', exact: true }).click();
  await page.getByLabel('Path').fill('/ttt/:id');
  await page.getByLabel('Path').blur();
  await page.locator('.mock-response-editor').getByText('Template', { exact: true }).click();
  await responseBody(page).waitReady();
  await responseBody(page).setDoc('{"id": "{{$request.params.id}}", "page": "{{$request.query.page}}"}');
  const preview = new AceEditorHandle(page, page.locator('.mock-preview .code-editor-ace'));
  await expect.poll(() => preview.value()).toBe('{"id": "1", "page": ""}');
  // 粘贴 Copy URL 复制的完整地址
  await page.getByLabel('Preview request').fill('http://127.0.0.1:3009/ttt/7?page=2');
  await expect.poll(() => preview.value()).toBe('{"id": "7", "page": "2"}');
});

test('leaves the cursor after the dot when completing a $request field', async ({ page }) => {
  await createService(page, '3010');
  await page.getByRole('button', { name: 'Route', exact: true }).click();
  const editor = page.locator('.mock-response-editor');

  // 响应体（Ace）：{{$request.headers.}} 插入后接着输入请求头名称
  const body = responseBody(page);
  await body.waitReady();
  await body.setDoc('{"trace": "|"}');
  await page.keyboard.type('{{$request.head');
  await expect(page.locator('.ak-hint-label')).toHaveText(['$request.headers.']);
  await page.keyboard.press('Enter');
  await expect(page.locator('.ak-hints')).toHaveCount(0);
  await page.keyboard.type('x-trace');
  expect(await body.value()).toBe('{"trace": "{{$request.headers.x-trace}}"}');

  // 其它补全项仍停在 }} 之后
  await body.setDoc('{"m": "|"}');
  await page.keyboard.type('{{$request.meth');
  await page.keyboard.press('Enter');
  await page.keyboard.type('X');
  expect(await body.value()).toBe('{"m": "{{$request.method}}X"}');

  // 响应头（单行输入框）
  await editor.getByRole('tab', { name: /^Headers/ }).click();
  const value = editor.getByPlaceholder('Value', { exact: true }).first();
  await value.click();
  await page.keyboard.type('id-{{$request.quer');
  await expect(page.locator('.variable-suggestions')).toContainText('$request.query.');
  await page.keyboard.press('Enter');
  await expect(page.locator('.variable-suggestions')).toBeHidden();
  await page.keyboard.type('page');
  await expect(value).toHaveValue('id-{{$request.query.page}}');
});

test('previews templates and saves real responses to a mock', async ({ app, page }) => {
  await createService(page, '3006');
  await page.getByRole('button', { name: 'Route', exact: true }).click();
  await page.getByLabel('Path').fill('/orders');
  await page.locator('.mock-response-editor').getByText('Template', { exact: true }).click();
  await responseBody(page).waitReady();
  await responseBody(page).setDoc('[{{#repeat $request.query.size ?? 3}}{"n": {{$index}}}{{/repeat}}]');
  const preview = new AceEditorHandle(page, page.locator('.mock-preview .code-editor-ace'));
  await expect.poll(() => preview.value()).toBe('[{"n": 1},{"n": 2},{"n": 3}]');
  await page.getByLabel('Preview request').fill('/orders?size=2');
  await expect.poll(() => preview.value()).toBe('[{"n": 1},{"n": 2}]');
  await expect(page.locator('.mock-response-editor')).toContainText('Preview · 2 items');

  // 发送真实请求后把响应保存到 Mock
  await app.newRequest();
  await app.url.fill('{{baseUrl}}/users/7');
  await app.setMockResponse({ status: 200, contentType: 'application/json', body: '{"id":7,"name":"Ann"}' });
  await app.request.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: 'Save to Mock' }).click();
  const dialog = page.locator('.p-dialog:visible');
  await expect(dialog.getByLabel('Path')).toHaveValue('/users/7');
  await dialog.getByLabel('Response name').fill('Ann');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);

  const routes = await app.run(() => window.__store('mocks').services[0].routes
    .map((route: any) => [route.method, route.path, route.responses.map((response: any) => [response.name, response.isDefault, response.body])]));
  expect(routes).toEqual([
    ['GET', '/orders', [['Success', true, '[{{#repeat $request.query.size ?? 3}}{"n": {{$index}}}{{/repeat}}]']]],
    ['GET', '/users/7', [['Ann', true, '{"id":7,"name":"Ann"}']]],
  ]);
});

test('stops, duplicates and deletes services from the sidebar', async ({ app, page }) => {
  await createService(page, '3007');
  const row = page.locator('[data-mock-service="Mock Service"]');
  await row.getByTitle('Stop').click();
  await expect(row).toContainText('Stopped');
  expect(await app.run(() => window.__invokes.some(([cmd]) => cmd === 'mock_stop'))).toBe(true);
  await expect(page.locator('.mock-workspace')).toContainText('Stopped');

  await row.click({ button: 'right' });
  await page.locator('.p-contextmenu:visible').getByText('Duplicate').click();
  await expect(page.locator('[data-mock-service="Mock Service (Copy)"]')).toContainText(':3001');

  await page.locator('[data-mock-service="Mock Service (Copy)"]').click({ button: 'right' });
  await page.locator('.p-contextmenu:visible').getByText('Delete').click();
  await page.locator('.p-confirmdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('[data-mock-service="Mock Service (Copy)"]')).toHaveCount(0);
  // 页签也随之关闭
  await expect(page.locator('.content-tabs [data-content-tab-index]')).toHaveCount(1);
});

test('shows the response body editor at full height in every body mode', async ({ page }) => {
  await createService(page, '3008');
  await page.getByRole('button', { name: 'Route', exact: true }).click();
  const editor = page.locator('.mock-response-editor');
  const body = responseBody(page);
  await body.waitReady();
  await body.setDoc('{"id": {{$index}}}');
  const editorHeights = () => editor.locator('.ace_editor').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));

  for (const mode of ['JSON', 'Template', 'Text']) {
    await editor.getByText(mode, { exact: true }).click();
    await expect.poll(async () => Math.min(...await editorHeights())).toBeGreaterThan(200);
    await expect(editor.locator('.ace_line').first()).toBeVisible();
  }
});
