// 文档截图：npm run docs:screenshots。在生产构建上布置示例数据、打开各界面并截图，
// 保存到 docs/public/screenshots/<名称>.png，文档中用 ![说明](/screenshots/<名称>.png) 引用。

import type { Locator, Page } from '@playwright/test';
import { AceEditorHandle, expect, test, type App } from '../../e2e/fixtures/app';

const OUT = 'docs/public/screenshots';

const shot = async (target: Page | Locator, name: string) => {
  await target.screenshot({ path: `${OUT}/${name}.png`, animations: 'disabled' });
};

const EMPTY_BODY = { type: 'none', raw: '', formData: [], urlencoded: [] };

/** 示例集合：Shop API，包含 Auth 和 Orders 文件夹 */
async function seedCollection(app: App) {
  await app.run(async (emptyBody) => {
    const cols = window.__store('collections');
    const requests = window.__store('requests');
    const c = await cols.createCollection('Shop API');
    const auth = await cols.addFolder(c.id, 'Auth');
    const orders = await cols.addFolder(c.id, 'Orders');
    const make = (id: string, name: string, method: string, url: string, folderId: string | null, extra: Record<string, unknown> = {}) => ({
      id, name, method, url, params: [], headers: [], body: emptyBody, auth: { type: 'none', token: '', username: '', password: '' },
      collectionId: c.id, folderId, ...extra,
    });
    const list = [
      make('req-login', 'Login', 'POST', '{{baseUrl}}/auth/login', auth.id, {
        body: { ...emptyBody, type: 'json', raw: '{\n  "username": "{{username}}",\n  "password": "{{password}}"\n}' },
      }),
      make('req-create-order', 'Create order', 'POST', '{{baseUrl}}/orders', orders.id, {
        headers: [{ key: 'Idempotency-Key', value: '{{$guid}}', enabled: true }],
        auth: { type: 'bearer', token: '{{token}}', username: '', password: '' },
        body: { ...emptyBody, type: 'json', raw: '{\n  "productId": "{{productId}}",\n  "quantity": 2,\n  "note": "Gift wrap"\n}' },
        testsConfig: {
          statusCodeTests: [{ enabled: true, operator: 'equals', expectedValue: '201', description: '' }],
          jsonFieldTests: [
            { enabled: true, jsonPath: '$.id', operator: 'exists', expectedValue: '', description: 'Order is created' },
            { enabled: true, jsonPath: '$.quantity', operator: 'equals', expectedValue: '2', description: '' },
          ],
          globalVariables: [
            { enabled: true, variableName: 'orderId', valueType: 'jsonPath', jsonPath: '$.id', customValue: '', description: '' },
            { enabled: true, variableName: 'requestId', valueType: 'header', headerName: 'x-request-id', jsonPath: '', customValue: '', description: '' },
          ],
        },
      }),
      make('req-get-order', 'Get order', 'GET', '{{baseUrl}}/orders/{{orderId}}', orders.id),
      make('req-pay-order', 'Pay order', 'POST', '{{baseUrl}}/orders/{{orderId}}/pay', orders.id),
      make('req-health', 'Health check', 'GET', '{{baseUrl}}/health', null),
    ];
    for (const request of list) {
      await requests.saveRequest(request, true);
      await cols.addRequestReference(c.id, request.id, request.name, request.method, request.url, request.folderId || undefined);
    }
    const env = await window.__store('environments').createEnvironment('Staging');
    await window.__store('environments').updateEnvironment(env.id, {
      variables: [{ key: 'baseUrl', value: 'https://api.example.com', enabled: true }, { key: 'username', value: 'alice', enabled: true }],
    });
    await window.__store('environments').setActiveEnvironment(env.id);
  }, EMPTY_BODY);
}

/** 发送并等加载遮罩消失 */
async function send(app: App) {
  await app.request.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(app.request.getByText('Sending Request...')).toHaveCount(0);
  await expect(app.request.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
}

async function openRequestFromTree(page: Page, name: string) {
  const tree = page.locator('.p-tree').first();
  for (const label of ['Shop API', 'Orders', 'Auth']) {
    const node = tree.locator('.p-tree-node-content', { hasText: label }).first();
    const toggle = node.locator('.p-tree-node-toggle-button');
    if (await node.count() && (await node.getAttribute('aria-expanded')) !== 'true' && await toggle.count()) await toggle.click();
  }
  await tree.getByText(name, { exact: true }).click();
}

test.beforeEach(async ({ app }) => {
  await app.open();
  await seedCollection(app);
});

test('requests, tests and responses', async ({ app, page }) => {
  await openRequestFromTree(page, 'Create order');
  await expect(app.url).toHaveValue('{{baseUrl}}/orders');
  await app.requestTab('Body');
  await app.setMockResponse({
    status: 201,
    statusText: 'Created',
    body: JSON.stringify({ id: 'ord_8f2k1', productId: 'prd_42', quantity: 2, status: 'created', total: 59.8, createdAt: '2026-10-14T09:30:00Z' }, null, 2),
  });
  await send(app);
  await expect(app.request.getByText('Status: 201', { exact: false })).toBeVisible();
  await app.requestTab('Params');
  await shot(page, 'request');

  // 折叠响应区，让 Tests 显示完整
  await app.request.getByTitle('Collapse response').first().click();
  await app.requestTab('Tests');
  await shot(page, 'tests');

  await app.setMockResponse({ status: 422, statusText: 'Unprocessable Entity', body: JSON.stringify({ error: 'quantity must be at most 1' }, null, 2) });
  await send(app);
  await app.request.getByRole('tab', { name: /Test Results/ }).click();
  await shot(page, 'test-results');
});

test('collections', async ({ page }) => {
  await openRequestFromTree(page, 'Get order');
  await page.screenshot({ path: `${OUT}/collections.png`, clip: { x: 0, y: 80, width: 320, height: 420 }, animations: 'disabled' });
});

test('streaming response', async ({ app, page }) => {
  await app.newRequest();
  await app.url.fill('https://api.example.com/v1/chat/completions');
  const chunk = (content: string, finish: string | null = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: finish }] })}\n\n`;
  const answer = ['## Order summary\n\n', 'Your order **ord_8f2k1** contains:\n\n', '- 2 × Coffee mug\n', '- Gift wrap\n\n', 'It will ship within **2 days**.'];
  await app.setMockResponse({
    contentType: 'text/event-stream',
    body: answer.map(text => chunk(text)).join('') + chunk('', 'stop')
      + `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 42, completion_tokens: 37 } })}\n\ndata: [DONE]\n\n`,
  });
  await send(app);
  await expect(app.request.getByText('It will ship within')).toBeVisible();
  await shot(page, 'streaming');
});

test('workflow editor and log', async ({ app, page }) => {
  await page.setViewportSize({ width: 1280, height: 1320 });
  await app.run(async () => {
    const condition = (path: string, value: string) => ({ source: 'lastResponse', field: 'jsonPath', path, operator: 'equals', expectedValue: value });
    await window.__store('workflows').saveWorkflow({
      id: 'wf-order', name: 'Place and track an order', version: 1, createdAt: '', updatedAt: '',
      steps: [
        { id: 's-reset', type: 'setVariables', name: 'Reset variables', enabled: true, variables: [{ key: 'orderId', value: '', enabled: true }, { key: 'runId', value: '{{$guid}}', enabled: true }] },
        { id: 's-login', type: 'request', name: 'Login', enabled: true, requestSource: 'reference', requestId: 'req-login' },
        { id: 's-order', type: 'request', name: 'Create order', enabled: true, requestSource: 'reference', requestId: 'req-create-order' },
        {
          id: 's-wait', type: 'until', name: 'Wait until paid and shipped', enabled: true, maxIterations: 60, delayMs: 300,
          conditionMatch: 'cumulative', conditions: [condition('$.status', 'payment_captured'), condition('$.status', 'shipped')],
          childSteps: [{ id: 's-get', type: 'request', name: 'Get order', enabled: true, requestSource: 'reference', requestId: 'req-get-order' }],
        },
      ],
    });
    // 模拟的接口：按请求返回响应，查询订单时状态逐次推进
    let polls = 0;
    Object.defineProperty(window, '__mockResponse', {
      configurable: true,
      get() {
        const last = window.__sent[window.__sent.length - 1];
        const url = String(last?.url || '');
        if (url.endsWith('/auth/login')) return { status: 200, statusText: 'OK', body: '{"data":{"token":"tok_9a7c"}}' };
        if (url.endsWith('/orders')) return { status: 201, statusText: 'Created', body: '{"id":"ord_8f2k1","quantity":2,"status":"created"}' };
        const status = ['paid', 'payment_captured', 'packing', 'shipped'][Math.min(polls++, 3)];
        return { status: 200, statusText: 'OK', body: JSON.stringify({ id: 'ord_8f2k1', status }) };
      },
    });
  });
  await page.getByRole('tab', { name: 'Workflows' }).click();
  await page.getByText('Place and track an order').click();
  await expect(page.getByTestId('workflow-condition-row')).toHaveCount(2);
  await shot(page, 'workflow');

  await page.getByRole('button', { name: 'Run workflow' }).click();
  await expect(page.getByRole('button', { name: 'Run workflow' })).toBeEnabled({ timeout: 20_000 });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: /^Log/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Wait until paid and shipped', { exact: true }).first()).toBeVisible();
  await shot(page, 'workflow-log');
  await dialog.getByText('Wait until paid and shipped', { exact: true }).first().click();
  await expect(dialog.getByTestId('condition-check-row')).toHaveCount(2);
  await shot(page, 'workflow-log-detail');
});

test('mock service', async ({ page }) => {
  await page.getByRole('tab', { name: 'Mocks' }).click();
  await page.getByRole('button', { name: 'New Mock Service' }).click();
  const dialog = page.locator('.p-dialog:visible');
  await dialog.getByLabel('Name').fill('Shop API mock');
  await dialog.getByLabel('Port').fill('3005');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.mock-workspace')).toBeVisible();
  await page.getByRole('button', { name: 'Route', exact: true }).click();
  await page.getByLabel('Path').fill('/orders');
  await page.getByLabel('Path').blur();
  const body = new AceEditorHandle(page, page.locator('.mock-response-editor .json-editor-container'));
  await body.waitReady();
  await body.setDoc([
    '{',
    '  "page": {{$request.query.page ?? 1}},',
    '  "items": [',
    '    {{#repeat $request.query.pageSize ?? 3}}',
    '    { "id": {{$index}}, "orderNo": "SO{{$randomInt(10000, 99999)}}", "status": "{{$pick(paid, pending)}}" }',
    '    {{/repeat}}',
    '  ]',
    '}',
  ].join('\n'));
  // 先写入内容再切换到 Template，模板编辑器随之显示内容
  await page.locator('.mock-response-editor').getByText('Template', { exact: true }).click();
  await page.getByLabel('Preview request').fill('/orders?page=2&pageSize=2');
  await expect(page.locator('.mock-response-editor')).toContainText('"page": 2');
  await shot(page, 'mock');
});

test('AI integration dialog', async ({ app, page }) => {
  await app.run(() => window.__store('mcp').setEnabled(true));
  await app.run(() => window.__store('mcp').openDialog());
  const dialog = page.locator('.p-dialog:visible');
  await expect(dialog).toContainText('Enable MCP server');
  await shot(dialog, 'mcp');
});
