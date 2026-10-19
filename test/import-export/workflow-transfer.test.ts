import { describe, it, expect, vi } from 'vitest';

// Tauri 插件在 node 测试环境下不可用，仅 mock 以避免导入期副作用。
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(),
  open: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: vi.fn(),
  readTextFile: vi.fn(),
}));

import { ImportExportService } from '@/services/import-export';
import { collectWorkflowRequestIds, inlineWorkflowReferences, summarizeWorkflow } from '@/utils/workflowTransfer';
import type { Request, WorkflowDefinition } from '@/types/models';

const service = new ImportExportService();

const request = (id: string, collectionId: string, url: string): Request => ({
  id,
  name: id,
  method: 'GET',
  url,
  params: [],
  headers: [],
  body: { type: 'none', raw: '', formData: [], urlencoded: [] },
  auth: { type: 'none' },
  tests: { statusCodeTests: [], jsonFieldTests: [], globalVariables: [] },
  collectionId,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as unknown as Request);

const workflow: WorkflowDefinition = {
  id: 'wf-1',
  name: 'Checkout',
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  steps: [
    { id: 's1', type: 'request', name: 'Login', enabled: true, requestSource: 'reference', requestId: 'r-login', requestOverrides: { url: 'http://override/login' } },
    {
      id: 's2',
      type: 'for',
      name: 'Loop',
      enabled: true,
      iterations: 2,
      childSteps: [
        { id: 's3', type: 'request', name: 'Order', enabled: true, requestSource: 'reference', requestId: 'r-order' },
        { id: 's4', type: 'request', name: 'Missing', enabled: true, requestSource: 'reference', requestId: 'r-elsewhere' },
      ],
    },
  ],
};

const bundle = {
  version: '1.1.0',
  exportedAt: '2026-01-01T00:00:00.000Z',
  collections: [
    { id: 'c-user', name: 'User', folders: [], requests: [{ id: 'r-login', name: 'r-login' }] },
    { id: 'c-order', name: 'Order', folders: [], requests: [{ id: 'r-order', name: 'r-order' }] },
  ],
  requests: [request('r-login', 'c-user', 'http://x/login'), request('r-order', 'c-order', 'http://x/order')],
  workflows: [workflow],
};

describe('summarizeWorkflow', () => {
  it('统计嵌套步骤与引用的请求', () => {
    const summary = summarizeWorkflow(workflow);
    expect(summary.steps).toBe(4);
    expect([...summary.requestIds].sort()).toEqual(['r-elsewhere', 'r-login', 'r-order']);
    expect(summary.inline).toBe(0);
  });
});

describe('parseImportData', () => {
  it('导入 1.1 文件时 Workflow 引用的请求 ID 换成新 ID', () => {
    const result = service.parseImportData(JSON.parse(JSON.stringify(bundle)));
    expect(result.collections).toHaveLength(2);
    expect(result.workflows).toHaveLength(1);

    const imported = result.workflows[0];
    expect(imported.id).not.toBe('wf-1');

    const login = result.requests.find(item => item.url === 'http://x/login')!;
    const order = result.requests.find(item => item.url === 'http://x/order')!;
    expect(login.id).not.toBe('r-login');
    expect(imported.steps[0].requestId).toBe(login.id);
    expect(imported.steps[1].childSteps![0].requestId).toBe(order.id);
    // 文件中没有的请求保持原 ID
    expect(imported.steps[1].childSteps![1].requestId).toBe('r-elsewhere');
    // 集合树里的请求引用与请求本身一致
    expect(result.collections[0].requests[0].id).toBe(login.id);
  });

  it('兼容 1.0 单 Collection 文件', () => {
    const result = service.parseImportData({
      version: '1.0.0',
      exportedAt: '2026-01-01T00:00:00.000Z',
      collection: bundle.collections[0],
      requests: [bundle.requests[0]],
    });
    expect(result.collections).toHaveLength(1);
    expect(result.requests).toHaveLength(1);
    expect(result.workflows).toEqual([]);
  });

  it('支持只含 Workflows 的文件', () => {
    const result = service.parseImportData({
      version: '1.1.0',
      exportedAt: '2026-01-01T00:00:00.000Z',
      collections: [],
      requests: [],
      workflows: [workflow],
    });
    expect(result.collections).toEqual([]);
    expect(result.workflows).toHaveLength(1);
  });

  it('读取 Workflow 所在文件夹的名称路径，且不写入 Workflow 定义以外的字段', () => {
    const result = service.parseImportData({
      version: '1.1.0',
      exportedAt: '2026-01-01T00:00:00.000Z',
      collections: [],
      requests: [],
      workflows: [
        { ...workflow, folderPath: ['Orders', ' ', 'After sales'] },
        { ...workflow, id: 'wf-2', folderPath: 'Orders' },
        { ...workflow, id: 'wf-3' },
      ],
    });
    expect(result.workflows.map(item => item.folderPath)).toEqual([['Orders', 'After sales'], undefined, undefined]);
    expect('folderPath' in result.workflows[1]).toBe(false);
  });

  it('拒绝无法识别的文件', () => {
    expect(() => service.parseImportData({ foo: 1 })).toThrow('Invalid import file format');
  });
});

describe('inlineWorkflowReferences', () => {
  const requestMap = new Map(bundle.requests.map(item => [item.id, item]));

  it('未保留的引用转成 inline 请求并应用覆盖配置', () => {
    const result = inlineWorkflowReferences(workflow, requestMap, new Set(['r-order']));
    const login = result.steps[0];
    expect(login.requestSource).toBe('inline');
    expect(login.requestId).toBeUndefined();
    expect(login.requestOverrides).toBeUndefined();
    expect(login.inlineRequest!.url).toBe('http://override/login');
    expect(login.inlineRequest!.id).not.toBe('r-login');

    const [order, missing] = result.steps[1].childSteps!;
    expect(order.requestSource).toBe('reference');
    expect(order.requestId).toBe('r-order');
    // 找不到的请求保持引用
    expect(missing.requestId).toBe('r-elsewhere');
    // 不修改原 Workflow
    expect(workflow.steps[0].requestId).toBe('r-login');
  });

  it('collectWorkflowRequestIds 合并多个 Workflow 的引用', () => {
    const inlined = inlineWorkflowReferences(workflow, requestMap, new Set());
    expect([...collectWorkflowRequestIds([inlined])]).toEqual(['r-elsewhere']);
  });
});
