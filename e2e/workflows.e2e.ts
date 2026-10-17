// Workflow 编辑器：条件步骤的多个条件和组合方式，以及运行日志中每个条件的结果。

import { expect, test } from './fixtures/app';

test.beforeEach(async ({ app }) => {
  await app.open();
});

test('edits several conditions of an until step and shows each result in the log', async ({ app, page }) => {
  await page.locator('button[title="New Workflow"]').click();
  await page.getByRole('button', { name: 'Until', exact: true }).first().click();

  const rows = page.getByTestId('workflow-condition-row');
  const match = page.getByTestId('condition-match');
  await expect(rows).toHaveCount(1);
  await expect(match).toHaveCount(0);

  await page.getByTestId('add-condition').click();
  await expect(rows).toHaveCount(2);
  await expect(match).toContainText('All conditions are true at once');

  await match.click();
  const options = page.locator('.p-select-overlay .p-select-option, .p-dropdown-panel .p-dropdown-item');
  await expect(options).toHaveText([
    'All conditions are true at once',
    'Any condition is true',
    'Each condition has been met (any order)',
  ]);
  await options.filter({ hasText: 'Each condition has been met' }).click();
  await expect(page.getByText('A condition stays met once it has been met')).toBeVisible();

  const delay = page.getByTestId('loop-delay').locator('input');
  await delay.fill('1500');
  await delay.blur();

  const workflowId = await app.run(() => window.__store('workflows').workflows[0].id);
  const draftStep = () => app.run((id) => {
    const step = window.__store('workflows').getWorkflowDraft(id)?.steps[0];
    return step && { match: step.conditionMatch, count: step.conditions.length };
  }, workflowId);
  await expect.poll(draftStep).toEqual({ match: 'cumulative', count: 2 });
  await expect.poll(() => app.run((id) => window.__store('workflows').getWorkflowDraft(id)?.steps[0].delayMs, workflowId)).toBe(1500);

  // 删到只剩一个条件时隐藏组合方式
  await rows.nth(1).getByRole('button', { name: 'Remove condition' }).click();
  await expect(rows).toHaveCount(1);
  await expect(match).toHaveCount(0);
  await expect.poll(draftStep).toEqual({ match: 'cumulative', count: 1 });

  // 运行一个累计满足的 until 循环：第 2 次循环后 loopIndex 为 3，第 4 次后为 5
  await app.run(async (id) => {
    const loopIndexIs = (value: string) => ({ source: 'loopIndex', field: 'value', operator: 'equals', expectedValue: value });
    await window.__store('workflows').runWorkflow({
      id, name: 'Workflow 1', version: 1, createdAt: '', updatedAt: '',
      steps: [{
        id: 'wait', type: 'until', name: 'Wait for both', enabled: true, maxIterations: 10, childSteps: [],
        conditions: [loopIndexIs('5'), loopIndexIs('3')], conditionMatch: 'cumulative',
      }],
    });
  }, workflowId);

  await page.getByRole('button', { name: /^Log/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Condition met · 2/2 conditions met').first()).toBeVisible();
  await dialog.getByText('Wait for both', { exact: true }).first().click();
  await expect(dialog.getByText('Each condition has been met (any order)')).toBeVisible();
  const checks = dialog.getByTestId('condition-check-row');
  await expect(checks).toHaveCount(2);
  await expect(checks.nth(0)).toContainText('Met at iteration 4');
  await expect(checks.nth(1)).toContainText('Met at iteration 2');
});

test('names an existing request step after the chosen request', async ({ app, page }) => {
  await app.run(async () => {
    const cols = window.__store('collections');
    const c = await cols.createCollection('Shop');
    for (const [id, name] of [['req-login', 'Login'], ['req-order', 'Create order']]) {
      const r = { id, name, method: 'GET', url: `https://example.com/${id}`, params: [], headers: [], body: { type: 'none', raw: '', formData: [], urlencoded: [] }, auth: { type: 'none' }, collectionId: c.id };
      await window.__store('requests').saveRequest(r, true);
      await cols.addRequestReference(c.id, r.id, r.name, r.method, r.url);
    }
  });
  await page.locator('button[title="New Workflow"]').click();
  await page.getByRole('button', { name: 'Existing Request', exact: true }).first().click();

  const stepName = page.getByTestId('step-name').first();
  const choose = async (label: string) => {
    await page.locator('.p-select', { hasText: /Select request|Login|Create order/ }).first().click();
    await page.locator('.p-select-option', { hasText: label }).click();
  };
  await expect(stepName).toHaveValue('Existing Request');
  await choose('Login');
  await expect(stepName).toHaveValue('Login');
  await choose('Create order');
  await expect(stepName).toHaveValue('Create order');

  // 改过的名称不再跟着请求变化
  await stepName.fill('Place the order');
  await choose('Login');
  await expect(stepName).toHaveValue('Place the order');
});

test('sets global variables from a Set Variables step', async ({ app, page }) => {
  await app.setGlobalVariables({ base: '10' });
  await page.locator('button[title="New Workflow"]').click();
  await page.getByRole('button', { name: 'Set Variables', exact: true }).first().click();

  const rows = page.getByTestId('set-variable-row');
  await expect(rows).toHaveCount(1);
  await rows.nth(0).getByPlaceholder('variable name').fill('page');
  await rows.nth(0).locator('input').nth(2).fill('1');
  await page.getByTestId('add-set-variable').click();
  await rows.nth(1).getByPlaceholder('variable name').fill('label');
  await rows.nth(1).locator('input').nth(2).fill('start-{{base}}');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Run workflow' }).click();
  const globals = () => app.run(() => Object.fromEntries(window.__store('environments').globalVariables.map((v: any) => [v.key, v.value])));
  await expect.poll(globals).toMatchObject({ page: '1', label: 'start-10' });

  await page.getByRole('button', { name: /^Log/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Set Variables', { exact: true }).last().click();
  await expect(dialog.getByTestId('set-variable-log-row')).toHaveText([/page\s*1/, /label\s*start-10/]);
});
