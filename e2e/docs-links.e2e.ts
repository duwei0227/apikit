// 界面中的 ? 图标：打开文档站中对应的章节（测试浏览器的语言为英文）。

import { expect, test, type App } from './fixtures/app';

const DOCS = 'https://duwei0227.github.io/apikit/en/guide/';
const opened = (app: App) => app.run(() => window.__invokes.filter(([cmd]) => cmd === 'plugin:opener|open_url').map(([, args]) => args.url));

test.beforeEach(async ({ app }) => {
  await app.open();
});

test('opens the workflow, test and MCP documentation from the help icons', async ({ app, page }) => {
  await page.locator('button[title="New Workflow"]').click();
  await page.getByRole('button', { name: 'Until', exact: true }).first().click();
  await page.getByRole('button', { name: 'Set Variables', exact: true }).first().click();
  await page.locator('[data-docs-topic="workflowConditions"]').first().click();
  await page.locator('[data-docs-topic="workflowLoops"]').first().click();
  await page.locator('[data-docs-topic="setVariables"]').first().click();

  await app.newRequest();
  await app.requestTab('Tests');
  await page.locator('[data-docs-topic="extractVariables"]').first().click();

  await app.run(() => window.__store('mcp').openDialog());
  await page.locator('[data-docs-topic="mcp"]').click();

  await expect.poll(() => opened(app)).toEqual([
    `${DOCS}workflow#several-conditions`,
    `${DOCS}workflow#loops`,
    `${DOCS}workflow#set-variables`,
    `${DOCS}tests#extract-variables-global-variable-settings`,
    `${DOCS}ai`,
  ]);
});

test('opens the mock template documentation from the response body', async ({ app, page }) => {
  await page.getByRole('tab', { name: 'Mocks' }).click();
  await page.getByRole('button', { name: 'New Mock Service' }).click();
  const dialog = page.locator('.p-dialog:visible');
  await dialog.getByLabel('Port').fill('3009');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await page.getByRole('button', { name: 'Route', exact: true }).click();
  await page.locator('[data-docs-topic="mockTemplate"]').click();
  await expect.poll(() => opened(app)).toEqual([`${DOCS}mock#template-syntax`]);
});
