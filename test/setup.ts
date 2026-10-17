import { beforeEach, vi } from 'vitest';
import { handleTauriInvoke, resetHttpbinMock } from './helpers/httpbin';
import { mockStorageService, resetMockStorage } from './helpers/mockStorage';

vi.mock('@/services/storage', () => ({
  storageService: mockStorageService,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((command: string, payload: any) => handleTauriInvoke(command, payload)),
}));

beforeEach(() => {
  resetMockStorage();
  resetHttpbinMock();
});
