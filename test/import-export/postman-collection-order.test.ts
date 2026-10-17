import { describe, it, expect, vi } from 'vitest';

// Tauri 插件在 node 测试环境下不可用，仅 mock 以避免导入期副作用；
// 本测试只覆盖纯转换逻辑，不触发对话框/文件读写。
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(),
  open: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: vi.fn(),
  readTextFile: vi.fn(),
}));

import { ImportExportService } from '@/services/import-export';

// 私有方法通过 as any 访问，避免为测试放宽公开 API。
const service = new ImportExportService() as any;

// 同一层级内 request 与 folder 交错的多层 Postman 集合
const postman = {
  info: { name: 'Root', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [
    { name: 'top-req-A', request: { method: 'GET', url: { raw: 'http://x/a' } } },
    {
      name: 'L1-folder',
      item: [
        { name: 'L2-req-1', request: { method: 'GET', url: { raw: 'http://x/1' } } },
        {
          name: 'L2-folder',
          item: [
            { name: 'L3-req', request: { method: 'POST', url: { raw: 'http://x/3' } } },
          ],
        },
        { name: 'L2-req-2', request: { method: 'GET', url: { raw: 'http://x/2' } } },
      ],
    },
    { name: 'top-req-B', request: { method: 'GET', url: { raw: 'http://x/b' } } },
  ],
};

// 模拟渲染层（CollectionsPanel.convertToTreeNode）的合并排序逻辑，
// 验证 order 能还原出与 Postman 完全一致的层级内顺序。
const renderOrder = (node: { folders?: any[]; requests?: any[] }): any[] => {
  const requests = node.requests || [];
  const folders = node.folders || [];
  const entries = [
    ...requests.map((r: any, idx: number) => ({ order: r.order, idx, kind: 'request', name: r.name, ref: r })),
    ...folders.map((f: any, idx: number) => ({ order: f.order, idx, kind: 'folder', name: f.name, ref: f })),
  ];
  const allOrdered = entries.length > 0 && entries.every(e => typeof e.order === 'number');
  if (allOrdered) {
    entries.sort((a, b) => (a.order as number) - (b.order as number));
  } else {
    entries.sort((a, b) => (a.kind !== b.kind ? (a.kind === 'folder' ? -1 : 1) : a.idx - b.idx));
  }
  return entries;
};

describe('fromPostmanCollection 保留层级内交错顺序', () => {
  it('为 folder 与 request 引用赋值连续 order', () => {
    const { collection } = service.fromPostmanCollection(postman);

    // 顶层：req(0) / folder(1) / req(2)
    const top = renderOrder(collection);
    expect(top.map(e => e.name)).toEqual(['top-req-A', 'L1-folder', 'top-req-B']);

    // L1 层：req(0) / folder(1) / req(2)
    const l1 = collection.folders[0];
    const l1Order = renderOrder(l1);
    expect(l1Order.map(e => e.name)).toEqual(['L2-req-1', 'L2-folder', 'L2-req-2']);
  });

  it('所有请求与文件夹均不丢失', () => {
    const { collection, requests } = service.fromPostmanCollection(postman);
    // 4 个请求：top-req-A、L2-req-1、L3-req、L2-req-2、top-req-B = 5 个
    expect(requests).toHaveLength(5);
    expect(collection.folders).toHaveLength(1);
    expect(collection.folders[0].folders).toHaveLength(1);
  });
});

describe('导出回 Postman 保留交错顺序（往返一致）', () => {
  it('collectionItemsToPostman 按 order 输出', () => {
    const { collection, requests } = service.fromPostmanCollection(postman);
    const requestMap = new Map(requests.map((r: any) => [r.id, r]));

    const items = service.collectionItemsToPostman(collection, requestMap);
    expect(items.map((i: any) => i.name)).toEqual(['top-req-A', 'L1-folder', 'top-req-B']);

    const l1Items = items[1].item;
    expect(l1Items.map((i: any) => i.name)).toEqual(['L2-req-1', 'L2-folder', 'L2-req-2']);
  });
});

describe('缺省 order 时回退到 folders 在前、requests 在后', () => {
  it('渲染合并顺序把 folders 放前面', () => {
    const node = {
      requests: [{ name: 'r1' }, { name: 'r2' }], // 无 order
      folders: [{ name: 'f1' }, { name: 'f2' }],   // 无 order
    };
    expect(renderOrder(node).map(e => e.name)).toEqual(['f1', 'f2', 'r1', 'r2']);
  });

  it('导出回退同样 folders 在前', () => {
    const collection = {
      id: 'c1',
      name: 'Legacy',
      folders: [{ id: 'f1', name: 'f1', folders: [], requests: [] }], // 无 order
      requests: [{ id: 'r1', name: 'r1', method: 'GET', url: 'http://x' }], // 无 order
    };
    const requestMap = new Map([
      ['r1', { id: 'r1', name: 'r1', method: 'GET', url: 'http://x', headers: [], params: [], body: { type: 'none' }, auth: { type: 'none' } }],
    ]);
    const items = service.collectionItemsToPostman(collection, requestMap);
    expect(items.map((i: any) => i.name)).toEqual(['f1', 'r1']);
  });
});

describe('Postman XML body conversion', () => {
  it('imports XML raw bodies from language metadata or content type', () => {
    const byLanguage = service.fromPostmanBody({
      mode: 'raw',
      raw: '<root/>',
      options: { raw: { language: 'xml' } },
    }, []);
    expect(byLanguage.type).toBe('xml');

    const byHeader = service.fromPostmanBody({ mode: 'raw', raw: '<Envelope/>' }, [
      { key: 'Content-Type', value: 'application/soap+xml', enabled: true },
    ]);
    expect(byHeader.type).toBe('xml');
  });

  it('exports XML raw bodies with XML language metadata', () => {
    const body = service.toPostmanBody({
      type: 'xml',
      raw: '<root/>',
      formData: [],
      urlencoded: [],
    });
    expect(body).toEqual({
      mode: 'raw',
      raw: '<root/>',
      options: { raw: { language: 'xml' } },
    });
  });
});

describe('Postman text and binary body conversion', () => {
  it('preserves text body language instead of treating it as JSON', () => {
    const body = service.fromPostmanBody({
      mode: 'raw',
      raw: 'plain text',
      options: { raw: { language: 'text' } },
    }, []);

    expect(body).toMatchObject({ type: 'text', raw: 'plain text' });
    expect(service.toPostmanBody(body)).toEqual({
      mode: 'raw',
      raw: 'plain text',
      options: { raw: { language: 'text' } },
    });
  });

  it('infers large unlabelled JSON without fully materializing its value', () => {
    const body = service.fromPostmanBody({ mode: 'raw', raw: '  {"name":"ApiKit"}\n' }, []);
    const largeBody = service.fromPostmanBody({
      mode: 'raw',
      raw: JSON.stringify({ payload: 'x'.repeat(64 * 1024) }),
    }, []);

    expect(body).toMatchObject({ type: 'json', raw: '  {"name":"ApiKit"}\n' });
    expect(largeBody.type).toBe('json');
  });

  it('does not infer malformed large bodies from their outer braces', () => {
    const raw = `{${'not-json'.repeat(10_000)}}`;
    const body = service.fromPostmanBody({ mode: 'raw', raw }, []);

    expect(body.type).toBe('text');
  });

  it('ignores disabled content-type headers when classifying raw bodies', () => {
    const body = service.fromPostmanBody({ mode: 'raw', raw: 'plain text' }, [
      { key: 'Content-Type', value: 'application/json', enabled: false },
    ]);

    expect(body.type).toBe('text');
  });

  it('round-trips binary body file paths', () => {
    const body = service.fromPostmanBody({ mode: 'file', file: { src: '/tmp/input.bin' } }, []);

    expect(body).toMatchObject({ type: 'binary', filePath: '/tmp/input.bin' });
    expect(service.toPostmanBody(body)).toEqual({
      mode: 'file',
      file: { src: '/tmp/input.bin' },
    });
  });

  it('preserves every file in a multi-file form-data field', () => {
    const body = service.fromPostmanBody({
      mode: 'formdata',
      formdata: [{ key: 'attachments', type: 'file', src: ['/tmp/a.txt', '/tmp/b.txt'] }],
    }, []);

    expect(body.formData).toEqual([
      { key: 'attachments', value: 'a.txt', type: 'file', enabled: true, filePath: '/tmp/a.txt' },
      { key: 'attachments', value: 'b.txt', type: 'file', enabled: true, filePath: '/tmp/b.txt' },
    ]);
  });
});
