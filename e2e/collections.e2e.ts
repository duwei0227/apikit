// 侧边栏集合树：新建、重命名（重名检查）、复制、移动、拖动、搜索和删除。

import { expect, test, type App } from './fixtures/app';
import type { Page } from '@playwright/test';

interface TreeShape { name: string; requests: string[]; folders: TreeShape[] }

const dialog = (page: Page) => page.locator('.p-dialog').last();
const tree = (page: Page) => page.locator('.p-tree').first();

function node(page: Page, label: string) {
  const escaped = label.replace(/[()]/g, '\\$&');
  return tree(page).locator('.p-tree-node-content', { hasText: new RegExp(`^\\s*(get|post)?\\s*${escaped}\\s*$`, 'i') }).first();
}

const treeItem = (page: Page, label: string) => tree(page).getByRole('treeitem', { name: label, exact: true });

async function expandAll(page: Page) {
  const collapsed = tree(page).locator('[role=treeitem][aria-expanded=false] > .p-tree-node-content .p-tree-node-toggle-button[data-p-leaf=false]');
  for (let i = 0; i < 20 && await collapsed.count(); i++) {
    await collapsed.first().click();
  }
}

async function contextMenu(page: Page, label: string, item: string) {
  await expandAll(page);
  await node(page, label).click({ button: 'right' });
  await page.locator('.p-contextmenu').getByText(item, { exact: true }).click();
}

test('duplicates the selected item with Cmd+D on macOS', async ({ app, page }) => {
  await createShop(app, page);
  await node(page, 'List').click();
  await expect(treeItem(page, 'List')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Meta+d');
  await expect(node(page, 'List (Copy)')).toBeVisible();
});

function collections(app: App): Promise<TreeShape[]> {
  return app.run(() => {
    const strip = (c: any): TreeShape => ({ name: c.name, requests: (c.requests || []).map((r: any) => r.name), folders: (c.folders || []).map(strip) });
    return window.__store('collections').collections.map(strip);
  });
}

/** 拖动树节点（模拟 Windows 上的指针拖动，WebView2 不支持 HTML5 拖放） */
async function pointerDrag(page: Page, from: string, to: string) {
  const a = (await node(page, from).locator('span.flex-1').boundingBox())!;
  const b = (await node(page, to).locator('span.flex-1').boundingBox())!;
  await page.mouse.move(a.x + 10, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 40, a.y + a.height / 2 + 10, { steps: 3 });
  await page.mouse.move(b.x + 10, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}

/** 新建集合 Shop，含文件夹 Orders（请求 Search）和请求 List、Create */
async function createShop(app: App, page: Page) {
  await page.getByText('New Collection').first().click();
  await dialog(page).getByPlaceholder('Enter a name').fill('Shop');
  await dialog(page).getByRole('button', { name: 'Create' }).click();
  await expect(node(page, 'Shop')).toBeVisible();

  await contextMenu(page, 'Shop', 'Add Folder');
  await dialog(page).getByPlaceholder('Enter a name').fill('Orders');
  await dialog(page).getByRole('button', { name: 'Create' }).click();
  await expect(dialog(page)).toBeHidden();
  await expandAll(page);
  await expect(node(page, 'Orders')).toBeVisible();

  await app.run(async () => {
    const cols = window.__store('collections');
    const reqs = window.__store('requests');
    const c = cols.collections[0];
    for (const [id, name, folderId] of [['r1', 'List', null], ['r2', 'Create', c.folders[0].id], ['r3', 'Search', c.folders[0].id]]) {
      const r = { id, name, method: 'GET', url: `https://example.com/${name}`, params: [], headers: [], body: { type: 'none', raw: '', formData: [], urlencoded: [] }, auth: { type: 'none' }, collectionId: c.id, folderId };
      await reqs.saveRequest(r, true);
      await cols.addRequestReference(c.id, id, name, 'GET', r.url, folderId || undefined);
    }
  });
  await expandAll(page);
}

test.beforeEach(async ({ app }) => {
  await app.open();
});

test('checks names when creating and renaming', async ({ app, page }) => {
  await createShop(app, page);

  await page.getByText('New Collection').first().click();
  await dialog(page).getByPlaceholder('Enter a name').fill('shop');
  await expect(dialog(page).getByText('This name already exists')).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: 'Create' })).toBeDisabled();
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();

  // 同一文件夹中的请求不能重名，提示在输入时就显示
  await contextMenu(page, 'Create', 'Rename');
  await dialog(page).getByPlaceholder('Enter a new name').fill('search');
  await expect(dialog(page).getByText('This name already exists')).toBeVisible();
  await dialog(page).getByPlaceholder('Enter a new name').fill('Create order');
  await dialog(page).getByRole('button', { name: 'Rename' }).click();

  await contextMenu(page, 'Orders', 'Rename');
  await dialog(page).getByPlaceholder('Enter a new name').fill('Order APIs');
  await dialog(page).getByRole('button', { name: 'Rename' }).click();

  await expect.poll(() => collections(app)).toEqual([
    { name: 'Shop', requests: ['List'], folders: [{ name: 'Order APIs', requests: ['Create order', 'Search'], folders: [] }] },
  ]);
  expect(await app.run(async () => (await window.__store('requests').loadRequest('r2')).name)).toBe('Create order');
});

test('duplicates requests, folders and collections', async ({ app, page }) => {
  await createShop(app, page);

  await contextMenu(page, 'List', 'Duplicate');
  // 复制后选中副本
  await expect(treeItem(page, 'List (Copy)')).toHaveAttribute('aria-checked', 'true');
  // Ctrl+D 复制选中的文件夹：副本放在原文件夹旁边并立即显示
  await node(page, 'Orders').click();
  await expect(treeItem(page, 'Orders')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Control+d');
  await expect(node(page, 'Orders (Copy)')).toBeVisible();
  await contextMenu(page, 'Shop', 'Duplicate');
  await expect(node(page, 'Shop (Copy)')).toBeVisible();

  const shop = { name: 'Shop', requests: ['List', 'List (Copy)'], folders: [
    { name: 'Orders', requests: ['Create', 'Search'], folders: [] },
    { name: 'Orders (Copy)', requests: ['Create', 'Search'], folders: [] },
  ] };
  await expect.poll(() => collections(app)).toEqual([shop, { ...shop, name: 'Shop (Copy)' }]);

  // 文件夹副本中的请求是独立的文件，指向新的文件夹
  const copies = await app.run(async () => {
    const c = window.__store('collections').collections[0];
    const folder = c.folders.find((f: any) => f.name === 'Orders (Copy)');
    const requests = await window.__store('requests').loadMultipleRequests(folder.requests.map((r: any) => r.id));
    return requests.map((r: any) => [r.name, r.folderId === folder.id, r.collectionId === c.id, ['r2', 'r3'].includes(r.id)]);
  });
  expect(copies).toEqual([['Create', true, true, false], ['Search', true, true, false]]);
});

test('moves requests with the Move dialog and searches the tree', async ({ app, page }) => {
  await createShop(app, page);

  await contextMenu(page, 'List', 'Move to...');
  await dialog(page).locator('.p-tree-node-toggle-button[data-p-leaf=false]').first().click();
  await dialog(page).locator('.p-tree-node-content', { hasText: 'Orders' }).first().click();
  await expect(dialog(page).getByText('Target: Shop / Orders')).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Move' }).click();

  await expect.poll(() => collections(app)).toEqual([
    { name: 'Shop', requests: [], folders: [{ name: 'Orders', requests: ['Create', 'Search', 'List'], folders: [] }] },
  ]);
  expect(await app.run(async () => {
    const r = await window.__store('requests').loadRequest('r1');
    return r.folderId === window.__store('collections').collections[0].folders[0].id;
  })).toBe(true);

  await page.getByPlaceholder('Search...').fill('sea');
  await expect(tree(page)).toHaveText(/^\s*Shop\s*Orders\s*GET\s*Search\s*$/i);
  await page.getByPlaceholder('Search...').fill('');
  await expandAll(page);
  await expect(node(page, 'List')).toBeVisible();
});

test('reveals the request of the current tab in collapsed folders', async ({ app, page }) => {
  await app.run(async (request) => {
    const cols = window.__store('collections');
    const c = await cols.createCollection('Deep');
    const outer = await cols.addFolder(c.id, 'Outer');
    const inner = await cols.addFolder(c.id, 'Inner', outer.id);
    const r = { ...request, id: 'deep-1', name: 'Deep request', method: 'GET', url: 'https://example.com/deep', collectionId: c.id, folderId: inner.id };
    await window.__store('requests').saveRequest(r, true);
    await cols.addRequestReference(c.id, r.id, r.name, r.method, r.url, inner.id);
  }, { params: [], headers: [], body: { type: 'none', raw: '', formData: [], urlencoded: [] }, auth: { type: 'none' } });
  await expect(node(page, 'Deep')).toBeVisible();
  await expect(node(page, 'Deep request')).toHaveCount(0);
  // 打开集合中的请求（例如从 Workflow 或 MCP）时，展开集合和上级文件夹并选中它
  await app.run(() => window.__store('appState').addOpenRequest('deep-1'));
  await expect(node(page, 'Deep request')).toBeVisible();
  await expect(treeItem(page, 'Deep request')).toHaveAttribute('aria-checked', 'true');
});

test('deletes the selected collection with the Delete key', async ({ app, page }) => {
  await createShop(app, page);
  await app.run(() => window.__store('collections').createCollection('Other'));
  await node(page, 'Other').click();
  await page.keyboard.press('Delete');
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(async () => (await collections(app)).map(c => c.name)).toEqual(['Shop']);
});

test.describe('pointer drag (Windows)', () => {
  test.use({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' });

  test('moves a request into another collection', async ({ app, page }) => {
    await createShop(app, page);
    await app.run(() => window.__store('collections').createCollection('Archive'));
    await expect(node(page, 'Archive')).toBeVisible();
    await pointerDrag(page, 'List', 'Archive');
    await expect.poll(async () => (await collections(app)).map(c => [c.name, c.requests])).toEqual([['Shop', []], ['Archive', ['List']]]);
  });

  test('an invalid drop does not undo a rename made just before', async ({ app, page }) => {
    await app.run(async () => {
      const cols = window.__store('collections');
      const alpha = await cols.createCollection('Alpha');
      await cols.addFolder(alpha.id, 'Folder F');
      await cols.createCollection('Beta');
    });
    await page.waitForTimeout(800);
    await expandAll(page);
    await app.run(async () => {
      const cols = window.__store('collections');
      await cols.updateCollection(cols.collections.find((c: any) => c.name === 'Beta').id, { name: 'Beta Renamed' });
    });
    // 文件夹不能移动到另一个集合
    await pointerDrag(page, 'Folder F', 'Beta Renamed');
    await page.waitForTimeout(800);
    expect((await collections(app)).map(c => [c.name, c.folders.map(f => f.name)])).toEqual([['Alpha', ['Folder F']], ['Beta Renamed', []]]);
    await expect(node(page, 'Beta Renamed')).toBeVisible();
  });
});

test.describe('save dialog', () => {
  const saveDialog = (page: Page) => page.locator('.p-dialog', { hasText: 'Save Request' });

  async function saveNewRequest(app: App, page: Page, url: string) {
    await app.newRequest();
    await app.url.fill(url);
    await app.url.click();
    await page.keyboard.press('Control+s');
    await expect(saveDialog(page)).toBeVisible();
  }

  const requestLocations = (app: App) => app.run(() => window.__store('collections').collections.map((c: any) => [
    c.name, c.requests.length, c.folders.map((f: any) => [f.name, f.requests.length]),
  ]));

  test('creates a collection in the dialog and remembers the last location', async ({ app, page }) => {
    await saveNewRequest(app, page, 'https://example.com/a');
    const dialog = saveDialog(page);
    await expect(dialog.getByText('No collections yet. Click New Collection to create one.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

    // Esc 只关闭新建集合的输入框
    await dialog.getByRole('button', { name: 'New Collection' }).click();
    await page.keyboard.press('Escape');
    await expect(dialog.getByPlaceholder('Collection name')).toBeHidden();
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'New Collection' }).click();
    await dialog.getByPlaceholder('Collection name').fill('Shop');
    await page.keyboard.press('Enter');
    await expect(dialog).toContainText('Selected: Shop (collection root)');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(saveDialog(page)).toBeHidden();
    await expect.poll(() => requestLocations(app)).toEqual([['Shop', 1, []]]);

    // 下次保存默认选中上次的位置；选中文件夹后再下次默认选中该文件夹
    await app.run(async () => {
      const cols = window.__store('collections');
      await cols.addFolder(cols.collections[0].id, 'Orders');
      await cols.createCollection('Archive');
    });
    await saveNewRequest(app, page, 'https://example.com/b');
    await expect(saveDialog(page)).toContainText('Selected: Shop (collection root)');
    await expect(saveDialog(page).getByRole('button', { name: 'New Collection' })).toBeVisible();
    await saveDialog(page).locator('.p-tree-node-toggle-button').first().click();
    await saveDialog(page).locator('.p-tree-node-content', { hasText: 'Orders' }).click();
    await saveDialog(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => requestLocations(app)).toEqual([['Shop', 1, [['Orders', 1]]], ['Archive', 0, []]]);

    await saveNewRequest(app, page, 'https://example.com/c');
    await expect(saveDialog(page)).toContainText('Selected: Shop / Orders');
    await expect(saveDialog(page).locator('.p-tree-node-selected')).toHaveText(/Orders/);
  });

  test('new collection names are checked for duplicates', async ({ app, page }) => {
    await app.run(() => window.__store('collections').createCollection('Shop'));
    await saveNewRequest(app, page, 'https://example.com/a');
    const dialog = saveDialog(page);
    // 只有一个集合时默认选中它
    await expect(dialog).toContainText('Selected: Shop (collection root)');
    await dialog.getByRole('button', { name: 'New Collection' }).click();
    await dialog.getByPlaceholder('Collection name').fill('shop');
    await expect(dialog.getByText('This name already exists')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Create' })).toBeDisabled();
  });
});
