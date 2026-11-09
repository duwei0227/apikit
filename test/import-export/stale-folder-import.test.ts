import { describe, expect, it, vi } from 'vitest';

// Tauri 插件在 node 测试环境下不可用，仅 mock 以避免导入期副作用。
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(), open: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeTextFile: vi.fn(), readTextFile: vi.fn() }));

import { ImportExportService } from '@/services/import-export';
import type { Request } from '@/types/models';

const request = (id: string, folderId: string | null): Request => ({
  id,
  name: id,
  method: 'GET',
  url: `https://example.com/${id}`,
  params: [],
  headers: [],
  body: { type: 'none', raw: '', formData: [], urlencoded: [] },
  auth: { type: 'none' },
  collectionId: 'c1',
  folderId,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as unknown as Request);

describe('importing collections', () => {
  it('places each request in the folder the collection structure shows, even when its folderId is out of date', () => {
    const result = new ImportExportService().parseImportData({
      version: '1.1.0',
      exportedAt: '2026-01-01T00:00:00.000Z',
      collections: [{
        id: 'c1',
        name: 'BPP',
        requests: [{ id: 'root', name: 'root' }],
        folders: [
          { id: 'robot', name: '机器人', requests: [], folders: [] },
          { id: 'prod', name: 'PROD', requests: [{ id: 'start', name: 'start' }], folders: [] },
        ],
      }],
      // start 在结构里属于 PROD，但请求记录里的 folderId 仍是移动前的 机器人；root 的记录也指向了 机器人
      requests: [request('start', 'robot'), request('root', 'robot')],
    });

    const [collection] = result.collections;
    const prod = collection.folders.find(folder => folder.name === 'PROD')!;
    const newIdOf = (oldId: string) => result.requests.find(item => item.name === oldId)!;
    expect(newIdOf('start').folderId).toBe(prod.id);
    expect(newIdOf('root').folderId).toBeNull();
    expect(newIdOf('start').collectionId).toBe(collection.id);
  });
});
