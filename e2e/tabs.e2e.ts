// 主区域页签：切换、拖动排序、关闭（含未保存确认）、复制，以及侧边栏拖动宽度和收起。

import { expect, test } from './fixtures/app';
import type { Page } from '@playwright/test';

const tab = (page: Page, index: number) => page.locator(`.content-tabs [data-content-tab-index="${index}"]`);

/** 页签标题，当前页签前面加 "*" */
function tabs(page: Page) {
  return page.locator('.content-tabs [data-content-tab-index]').evaluateAll(els =>
    els.map(el => (el.getAttribute('data-p-active') === 'true' ? '*' : '') + (el as HTMLElement).innerText.trim()));
}

test.beforeEach(async ({ app, page }) => {
  await app.open();
  for (const host of ['a', 'b', 'c']) {
    await page.locator('button[title="New Request"]').click();
    await app.url.fill(`https://${host}.example.com`);
  }
  await page.locator('button[title="New Workflow"]').click();
  await expect.poll(() => tabs(page)).toEqual(['Untitled Request', 'Untitled Request', 'Untitled Request', '*Workflow 1']);
});

test('switches, reorders, duplicates and closes tabs', async ({ app, page }) => {
  await tab(page, 0).click();
  await expect(app.url).toHaveValue('https://a.example.com');

  // 拖动第一个页签到最后
  const first = (await tab(page, 0).boundingBox())!;
  const last = (await tab(page, 3).boundingBox())!;
  await page.mouse.move(first.x + 30, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + 60, first.y + first.height / 2, { steps: 4 });
  await page.mouse.move(last.x + last.width - 10, last.y + last.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => tabs(page)).toEqual(['Untitled Request', 'Untitled Request', 'Workflow 1', '*Untitled Request']);
  await expect(app.url).toHaveValue('https://a.example.com');

  // 中键关闭未保存的请求：询问后放弃修改
  await tab(page, 1).click({ button: 'middle' });
  const confirm = page.locator('.p-confirmdialog');
  await expect(confirm).toContainText('You have unsaved changes');
  await confirm.getByRole('button', { name: 'Discard' }).click();
  await expect.poll(() => tabs(page)).toEqual(['Untitled Request', 'Workflow 1', '*Untitled Request']);

  await tab(page, 0).click({ button: 'right' });
  await page.locator('.p-contextmenu:visible').getByText('Duplicate Tab').click();
  await expect.poll(() => tabs(page)).toEqual(['Untitled Request', '*Untitled Request (Copy)', 'Workflow 1', 'Untitled Request']);

  // 刚复制的页签没有修改，直接关闭
  await tab(page, 1).locator('.content-tab-close').click();
  await expect.poll(() => tabs(page)).toEqual(['Untitled Request', '*Workflow 1', 'Untitled Request']);

  // 关闭其它页签：一次确认所有未保存的页签
  await tab(page, 0).click({ button: 'right' });
  await page.locator('.p-contextmenu:visible').getByText('Close Other Tabs').click();
  await expect(confirm).toContainText('You have 1 tab(s) with unsaved changes');
  await confirm.getByRole('button', { name: 'Discard & Close' }).click();
  await expect.poll(() => tabs(page)).toEqual(['*Untitled Request']);

  await page.locator('button[title="More Options"]').click();
  await page.locator('.p-contextmenu:visible').getByText('Close All Tabs').click();
  if (await confirm.isVisible()) await confirm.getByRole('button', { name: /Discard/ }).click();
  await expect.poll(() => tabs(page)).toEqual([]);
  await expect(page.getByText('Nothing Open')).toBeVisible();
});

test('resizes, collapses and expands the sidebar', async ({ page }) => {
  const sidebar = page.locator('aside.sidebar');
  const drag = async (toX: number) => {
    const handle = (await page.locator('.resize-handle').boundingBox())!;
    await page.mouse.move(handle.x + 2, handle.y + 200);
    await page.mouse.down();
    await page.mouse.move(toX, handle.y + 200, { steps: 8 });
    await page.mouse.up();
  };

  await drag(250);
  await expect(sidebar).toHaveAttribute('style', /width: 250px/);
  // 拖得很窄时收起
  await drag(110);
  await expect(page.locator('.collapsed-sidebar-button')).toHaveCount(1);
  await page.locator('button[title="Expand Sidebar"]').click();
  await expect(sidebar).toHaveAttribute('style', /width: 320px/);
});
