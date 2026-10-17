import { describe, it, expect, vi, beforeEach } from 'vitest';

const files = new Map<string, string>();

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(async () => '/out/apikit-environments.json'),
  open: vi.fn(async () => '/out'),
}));
vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: vi.fn(async (path: string, content: string) => { files.set(path, content); }),
  readTextFile: vi.fn(),
  exists: vi.fn(async (path: string) => files.has(path)),
}));
vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));

import { open, save } from '@tauri-apps/plugin-dialog';
import { ImportExportService } from '@/services/import-export';
import type { Environment } from '@/types/models';

const service = new ImportExportService();

const env = (id: string, name: string): Environment => ({
  id,
  name,
  isActive: false,
  variables: [{ key: 'host', value: `${id}.example.com`, enabled: true }],
});

beforeEach(() => {
  files.clear();
  vi.mocked(open).mockClear();
  vi.mocked(save).mockClear();
});

describe('exportEnvironments', () => {
  it('ApiKit 格式把多个环境写入一个文件', async () => {
    const ok = await service.exportEnvironments([env('a', 'Local'), env('b', 'Staging')], 'apikit');
    expect(ok).toBe(true);
    expect(open).not.toHaveBeenCalled();
    const data = JSON.parse(files.get('/out/apikit-environments.json')!);
    expect(data.environments.map((item: Environment) => item.name)).toEqual(['Local', 'Staging']);
  });

  it('Postman 格式选多个时每个环境写入单独文件，不覆盖已有文件', async () => {
    files.set('/out/Local.postman_environment.json', 'existing');
    const ok = await service.exportEnvironments(
      [env('a', 'Local'), env('b', 'QA/Shanghai'), env('c', 'qa_shanghai'), env('d', 'QA/Shanghai')],
      'postman'
    );
    expect(ok).toBe(true);
    expect(open).toHaveBeenCalledWith({ directory: true, multiple: false });
    expect(files.get('/out/Local.postman_environment.json')).toBe('existing');
    expect([...files.keys()].sort()).toEqual([
      '/out/Local (2).postman_environment.json',
      '/out/Local.postman_environment.json',
      '/out/QA_Shanghai (3).postman_environment.json',
      '/out/QA_Shanghai.postman_environment.json',
      // 按不区分大小写去重，保留各自原名的大小写
      '/out/qa_shanghai (2).postman_environment.json',
    ]);
    const local = JSON.parse(files.get('/out/Local (2).postman_environment.json')!);
    expect(local._postman_variable_scope).toBe('environment');
    expect(local.values[0]).toMatchObject({ key: 'host', value: 'a.example.com' });
  });

  it('取消选择文件夹时不写文件', async () => {
    vi.mocked(open).mockResolvedValueOnce(null);
    const ok = await service.exportEnvironments([env('a', 'Local'), env('b', 'Staging')], 'postman');
    expect(ok).toBe(false);
    expect(files.size).toBe(0);
  });

  it('只选一个环境时与单个导出一致', async () => {
    vi.mocked(save).mockResolvedValueOnce('/out/one.json');
    await service.exportEnvironments([env('a', 'Local')], 'apikit');
    expect(JSON.parse(files.get('/out/one.json')!).environment.name).toBe('Local');
  });
});
