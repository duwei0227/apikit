// 选择 OpenAPI / Swagger 文件并生成 Mock 路由

import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { parse as parseYaml } from 'yaml';
import { isOpenApiDocument, mockRoutesFromOpenApiDocument, type OpenApiMockResult } from '@/services/import-export/openapi';

export interface OpenApiMockFile extends OpenApiMockResult {
  fileName: string;
}

/** 用户取消时返回 null；文件不是 OpenAPI 文档时抛出错误 */
export async function pickOpenApiMockFile(): Promise<OpenApiMockFile | null> {
  const filePath = await open({ multiple: false, filters: [{ name: 'OpenAPI (JSON / YAML)', extensions: ['json', 'yaml', 'yml'] }] });
  if (!filePath) return null;
  const path = String(filePath);
  const isYaml = /\.ya?ml$/i.test(path);
  let data: unknown;
  try {
    const text = await readTextFile(path);
    data = isYaml ? parseYaml(text, { maxAliasCount: 10000 }) : JSON.parse(text);
  } catch {
    throw new Error(isYaml ? 'The file is not valid YAML' : 'The file is not valid JSON');
  }
  if (!isOpenApiDocument(data)) throw new Error('The file is not an OpenAPI 3.x or Swagger 2.0 document');
  return { fileName: path.split(/[\\/]/).pop() || path, ...mockRoutesFromOpenApiDocument(data) };
}
