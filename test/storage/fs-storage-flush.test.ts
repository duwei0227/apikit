import { describe, expect, it, vi } from 'vitest';
import { readDir, readTextFile, remove } from '@tauri-apps/plugin-fs';

const written = new Map<string, string>();
vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(async (path: string, content: string) => { written.set(path, content); }),
  exists: vi.fn(async () => true),
  mkdir: vi.fn(),
  readDir: vi.fn(async () => []),
  remove: vi.fn(),
}));
vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn(async () => '/data'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));

import { FileSystemStorageService } from '@/services/storage/FileSystemStorageService';

describe('file system storage flush', () => {
  it('STORAGE-001 writes pending debounced saves instead of dropping them', async () => {
    const service = new FileSystemStorageService();
    await service.initialize();
    const collection: any = { id: 'c1', name: 'Before', folders: [], requests: [] };

    await service.saveCollection(collection);
    collection.name = 'After';
    await service.saveCollection(collection);
    expect([...written.keys()].some(path => path.endsWith('c1.json'))).toBe(false);

    await service.flush();
    const path = [...written.keys()].find(key => key.endsWith('c1.json'))!;
    expect(JSON.parse(written.get(path)!).name).toBe('After');
  });

  it('STORAGE-002 writes history and console logs without indentation', async () => {
    const service = new FileSystemStorageService();
    await service.initialize();
    await service.saveConsoleLogs([{ id: '1' } as any]);
    const path = [...written.keys()].find(key => key.endsWith('console-logs.json'))!;
    expect(written.get(path)).toBe('[{"id":"1"}]');
  });

  it('STORAGE-003 saves each log body in its own file and deletes the ones no longer listed', async () => {
    const service = new FileSystemStorageService();
    await service.initialize();
    await service.saveLogBody('console', '17/a:b', { requestBody: null, responseBody: 'ok' });
    const path = [...written.keys()].find(key => key.includes('console-bodies'))!;
    expect(path).toBe('/data/history/console-bodies/17_a_b.json');
    expect(written.get(path)).toBe('{"requestBody":null,"responseBody":"ok"}');

    vi.mocked(readTextFile).mockResolvedValueOnce('{"body":"x"}');
    expect(await service.loadLogBody('history', 'h1')).toEqual({ body: 'x' });

    vi.mocked(readDir).mockResolvedValueOnce([
      { name: 'keep.json', isFile: true, isDirectory: false, isSymlink: false },
      { name: 'old.json', isFile: true, isDirectory: false, isSymlink: false },
    ]);
    await service.deleteLogBodiesExcept('history', ['keep']);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('/data/history/history-bodies/old.json');
  });
});
