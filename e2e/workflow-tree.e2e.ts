// 侧边栏 Workflow 树：文件夹的新建、重命名（重名检查）、删除，搜索，以及拖动排序和移入文件夹。

import { expect, test, type App } from './fixtures/app';
import type { Page } from '@playwright/test';

const dialog = (page: Page) => page.locator('.p-dialog').last();
const tree = (page: Page) => page.locator('.workflow-tree .p-tree');
const node = (page: Page, label: string) => tree(page).locator('.p-tree-node-content', { hasText: new RegExp(`^\\s*${label}\\s*$`) }).first();

/** 侧边栏中的显示顺序：文件夹为 [名称, 子项] */
async function treeShape(app: App) {
  return app.run(() => {
    const store = window.__store('workflows');
    const names = new Map(store.workflows.map((w: any) => [w.id, w.name]));
    const shape = (items: any[]): unknown[] => items.map(item => (
      item.type === 'folder' ? [item.name, shape(item.children)] : names.get(item.id)
    ));
    return shape(store.layout.items);
  });
}

async function openWorkflowsTab(page: Page) {
  await page.getByText('Workflows', { exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'New Workflow', exact: true })).toBeVisible();
}

async function submitName(page: Page, name: string, action = 'Create') {
  await dialog(page).locator('input').fill(name);
  await dialog(page).getByRole('button', { name: action }).click();
  await expect(dialog(page)).toBeHidden();
}

async function setExpanded(page: Page, label: string, expanded: boolean) {
  const item = tree(page).getByRole('treeitem', { name: label, exact: true });
  if ((await item.getAttribute('aria-expanded')) !== String(expanded)) await node(page, label).click();
  await expect(item).toHaveAttribute('aria-expanded', String(expanded));
}

async function contextMenu(page: Page, label: string, item: string) {
  await node(page, label).click({ button: 'right' });
  await page.locator('.p-contextmenu').getByText(item, { exact: true }).click();
}

/** 根目录：文件夹 Orders（Checkout）、Login、Refund */
async function createOrders(app: App) {
  await app.run(async () => {
    const store = window.__store('workflows');
    const ordersId = await store.createFolder('Orders');
    await store.createWorkflow('Checkout', ordersId);
    await store.createWorkflow('Login');
    await store.createWorkflow('Refund');
  });
}

test.beforeEach(async ({ app, page }) => {
  await app.open();
  await openWorkflowsTab(page);
});

test('creates, renames and deletes folders and the workflows in them', async ({ app, page }) => {
  await page.getByRole('button', { name: 'New Folder' }).click();
  await expect(dialog(page)).toContainText('New Folder');
  await submitName(page, 'Orders');
  await expect(node(page, 'Orders')).toBeVisible();

  // 文件夹行上的按钮在文件夹中新建 Workflow，并在页签中打开
  await node(page, 'Orders').hover();
  await node(page, 'Orders').getByRole('button', { name: 'New Workflow in Folder' }).click();
  await submitName(page, 'Checkout');
  await expect(node(page, 'Checkout')).toBeVisible();
  await expect(page.locator('.p-tabview-tablist, [role=tablist]').getByText('Checkout').first()).toBeVisible();

  // 同一位置的文件夹不能重名
  await page.getByRole('button', { name: 'New Folder' }).click();
  await dialog(page).locator('input').fill('orders');
  await expect(dialog(page).getByText('This name already exists')).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: 'Create' })).toBeDisabled();
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();

  await contextMenu(page, 'Orders', 'New Folder');
  await submitName(page, 'After sales');
  await contextMenu(page, 'After sales', 'Rename');
  await submitName(page, 'Returns', 'Rename');
  await expect.poll(() => treeShape(app)).toEqual([['Orders', ['Checkout', ['Returns', []]]]]);

  // 点击文件夹折叠和展开
  await node(page, 'Orders').click();
  await expect(node(page, 'Checkout')).toBeHidden();
  await node(page, 'Orders').click();
  await expect(node(page, 'Checkout')).toBeVisible();

  await contextMenu(page, 'Orders', 'Delete');
  await expect(page.locator('.p-confirmdialog')).toContainText('"Orders" and the 1 workflow in it');
  await page.locator('.p-confirmdialog').getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => treeShape(app)).toEqual([]);
  await expect(page.getByText('No workflows yet')).toBeVisible();
});

test('pressing Enter in the name dialog does not create the folder or workflow', async ({ app, page }) => {
  // 和集合的 New Folder / Rename 对话框一致：只能点按钮提交（输入法按 Enter 上屏时不会误创建）
  await page.getByRole('button', { name: 'New Folder' }).click();
  await dialog(page).locator('input').fill('Orders');
  await dialog(page).locator('input').press('Enter');
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).locator('input')).toHaveValue('Orders');
  await expect.poll(() => treeShape(app)).toEqual([]);
  await dialog(page).getByRole('button', { name: 'Create' }).click();
  await expect.poll(() => treeShape(app)).toEqual([['Orders', []]]);

  await page.getByRole('button', { name: 'New Workflow', exact: true }).click();
  await dialog(page).locator('input').fill('Login');
  await dialog(page).locator('input').press('Enter');
  await expect(dialog(page)).toBeVisible();
  await expect.poll(() => treeShape(app)).toEqual([['Orders', []]]);
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
});

test('searches workflows inside folders', async ({ app, page }) => {
  await createOrders(app);
  await expect(node(page, 'Refund')).toBeVisible();
  // 折叠的文件夹中的匹配项在搜索时也显示
  await setExpanded(page, 'Orders', false);
  await expect(node(page, 'Checkout')).toBeHidden();

  await page.getByPlaceholder('Search...').fill('check');
  await expect(node(page, 'Orders')).toBeVisible();
  await expect(node(page, 'Checkout')).toBeVisible();
  await expect(node(page, 'Login')).toBeHidden();

  await page.getByPlaceholder('Search...').fill('nothing');
  await expect(page.getByText('No matching workflows found')).toBeVisible();

  // 结束搜索后恢复原来的折叠状态
  await page.getByPlaceholder('Search...').fill('');
  await expect(node(page, 'Login')).toBeVisible();
  await expect(node(page, 'Checkout')).toBeHidden();
});

test('drags workflows into folders and reorders them', async ({ app, page }) => {
  await createOrders(app);
  await expect(node(page, 'Refund')).toBeVisible();
  await setExpanded(page, 'Orders', true);

  await node(page, 'Refund').dragTo(node(page, 'Orders'));
  await expect.poll(() => treeShape(app)).toEqual([['Orders', ['Checkout', 'Refund']], 'Login']);

  // 拖到根目录中 Workflow 的上边缘时放在它前面
  await node(page, 'Checkout').dragTo(node(page, 'Login'), { targetPosition: { x: 20, y: 2 } });
  await expect.poll(() => treeShape(app)).toEqual([['Orders', ['Refund']], 'Checkout', 'Login']);
});

test.describe('pointer drag (Windows)', () => {
  test.use({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' });

  async function pointerDrag(page: Page, from: string, to: string, ratio = 0.5) {
    const a = (await node(page, from).locator('span.flex-1').boundingBox())!;
    const b = (await node(page, to).boundingBox())!;
    await page.mouse.move(a.x + 10, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + 40, a.y + a.height / 2 + 10, { steps: 3 });
    await page.mouse.move(b.x + 40, b.y + b.height * ratio, { steps: 8 });
    await page.mouse.up();
  }

  test('moves workflows into folders, between folders and to the top level', async ({ app, page }) => {
    await createOrders(app);
    await app.run(() => window.__store('workflows').createFolder('Archive'));
    await expect(node(page, 'Archive')).toBeVisible();
    await setExpanded(page, 'Orders', true);

    // 文件夹中间：放进去
    await pointerDrag(page, 'Login', 'Archive');
    await expect.poll(() => treeShape(app)).toEqual([['Orders', ['Checkout']], 'Refund', ['Archive', ['Login']]]);

    // 文件夹也可以放进另一个文件夹
    await setExpanded(page, 'Archive', true);
    await pointerDrag(page, 'Archive', 'Orders');
    await expect.poll(() => treeShape(app)).toEqual([['Orders', ['Checkout', ['Archive', ['Login']]]], 'Refund']);

    // Workflow 的下半部分：放在它后面（移出文件夹）
    await pointerDrag(page, 'Checkout', 'Refund', 0.8);
    await expect.poll(() => treeShape(app)).toEqual([['Orders', [['Archive', ['Login']]]], 'Refund', 'Checkout']);

    // 重新载入后保持
    await app.run(() => window.__store('workflows').loadWorkflows());
    await expect.poll(() => treeShape(app)).toEqual([['Orders', [['Archive', ['Login']]]], 'Refund', 'Checkout']);
  });
});
