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
import type { Environment } from '@/types/models';

// 私有方法通过 as any 访问，避免为测试放宽公开 API。
const service = new ImportExportService() as any;

const makeEnv = (overrides: Partial<Environment> = {}): Environment => ({
  id: 'env-1',
  name: 'Staging',
  isActive: true,
  variables: [
    { key: 'baseUrl', value: 'https://api.example.com', enabled: true },
    { key: 'token', value: 'secret', enabled: false },
    { key: '', value: 'ignored', enabled: true }, // 无 key，应被过滤
  ],
  ...overrides,
});

describe('toPostmanEnvironment', () => {
  it('生成标准 Postman 环境结构并过滤空 key', () => {
    const result = service.toPostmanEnvironment(makeEnv());

    expect(result._postman_variable_scope).toBe('environment');
    expect(result._postman_exported_using).toBe('ApiKit');
    expect(typeof result._postman_exported_at).toBe('string');
    expect(result.name).toBe('Staging');

    // 空 key 被过滤，只剩 2 个变量
    expect(result.values).toHaveLength(2);
    expect(result.values[0]).toEqual({
      key: 'baseUrl',
      value: 'https://api.example.com',
      type: 'default',
      enabled: true,
    });
    // enabled:false 透传
    expect(result.values[1].enabled).toBe(false);
  });

  it('缺失 id 时生成新 id', () => {
    const result = service.toPostmanEnvironment(makeEnv({ id: '' }));
    expect(result.id).toBeTruthy();
  });
});

describe('isPostmanEnvironment', () => {
  it('识别带 _postman_variable_scope 的文件', () => {
    expect(service.isPostmanEnvironment({ _postman_variable_scope: 'environment' })).toBe(true);
  });

  it('识别仅含 name + values 的文件', () => {
    expect(service.isPostmanEnvironment({ name: 'Env', values: [] })).toBe(true);
  });

  it('拒绝 ApiKit 导出格式', () => {
    expect(service.isPostmanEnvironment({ version: '1.0.0', environment: {} })).toBe(false);
  });
});

describe('fromPostmanEnvironment + remapEnvironment', () => {
  it('Postman values 转换为内部 variables，归一化默认值', () => {
    const postman = {
      id: 'pm-1',
      name: 'Prod',
      values: [
        { key: 'host', value: 'example.com', type: 'default', enabled: true },
        { key: 'flag', value: 123, type: 'secret' }, // 无 enabled -> 默认 true；非字符串 value 转字符串
        { value: 'no-key' }, // 无 key，应被过滤
      ],
      _postman_variable_scope: 'environment',
    };

    const mapped = service.remapEnvironment(service.fromPostmanEnvironment(postman));

    expect(mapped.name).toBe('Prod');
    expect(mapped.isActive).toBe(false);
    expect(mapped.id).toBeTruthy();
    expect(mapped.variables).toHaveLength(2);
    expect(mapped.variables[0]).toMatchObject({ key: 'host', value: 'example.com', enabled: true });
    expect(mapped.variables[1]).toMatchObject({ key: 'flag', value: '123', enabled: true });
  });

  it('缺失 name 时使用默认名称', () => {
    const mapped = service.fromPostmanEnvironment({ values: [] });
    expect(mapped.name).toBe('Imported Environment');
  });
});

describe('round-trip', () => {
  it('内部 -> Postman -> 内部 后 key/value/enabled 一致', () => {
    const env = makeEnv();
    const postman = service.toPostmanEnvironment(env);
    const back = service.remapEnvironment(service.fromPostmanEnvironment(postman));

    const expected = env.variables
      .filter(v => v.key)
      .map(v => ({ key: v.key, value: v.value, enabled: v.enabled !== false }));

    expect(back.variables.map((v: any) => ({ key: v.key, value: v.value, enabled: v.enabled })))
      .toEqual(expected);
  });
});
