// Postman Collection v2.1 和环境文件中 ApiKit 读写的部分。
// 导入的文件来自外部，字段可能缺失或类型不对，读取时逐项检查，所以导入用的类型字段都是可选的 unknown；
// 导出时由 ApiKit 生成，类型是确定的。

// ── 导入 ─────────────────────────────────────────────────────────────────────

export interface PostmanUrlIn {
  raw?: unknown;
  protocol?: unknown;
  host?: unknown;
  path?: unknown;
  query?: unknown;
}

export interface PostmanBodyIn {
  mode?: unknown;
  raw?: unknown;
  urlencoded?: unknown;
  formdata?: unknown;
  file?: { src?: unknown };
  graphql?: unknown;
  options?: { raw?: { language?: unknown } };
}

export interface PostmanAuthIn {
  type?: unknown;
  bearer?: unknown;
  basic?: unknown;
}

export interface PostmanRequestIn {
  method?: unknown;
  header?: unknown;
  url?: string | PostmanUrlIn;
  body?: PostmanBodyIn;
  auth?: PostmanAuthIn;
}

export interface PostmanItemIn {
  name?: unknown;
  description?: unknown;
  /** 有 item 时是文件夹 */
  item?: unknown;
  request?: string | PostmanRequestIn;
  auth?: PostmanAuthIn;
}

export interface PostmanCollectionIn {
  info: { name: string; description?: unknown };
  item: PostmanItemIn[];
  auth?: PostmanAuthIn;
}

export interface PostmanEnvironmentIn {
  id?: unknown;
  name?: unknown;
  values?: unknown;
  _postman_variable_scope?: unknown;
}

// ── 导出 ─────────────────────────────────────────────────────────────────────

export interface PostmanKeyValueOut {
  key: string;
  value?: string;
  disabled?: true;
  type?: string;
  src?: string;
}

export interface PostmanUrlOut {
  raw: string;
  protocol?: string;
  host: string[];
  path: string[];
  query: PostmanKeyValueOut[];
}

export type PostmanBodyOut =
  | { mode: 'urlencoded'; urlencoded: PostmanKeyValueOut[] }
  | { mode: 'formdata'; formdata: PostmanKeyValueOut[] }
  | { mode: 'file'; file: { src: string } }
  | { mode: 'raw'; raw: string; options: { raw: { language: 'xml' | 'text' | 'json' } } };

export type PostmanAuthOut =
  | { type: 'bearer'; bearer: PostmanKeyValueOut[] }
  | { type: 'basic'; basic: PostmanKeyValueOut[] };

export interface PostmanRequestItemOut {
  name: string;
  request: {
    method: string;
    header: PostmanKeyValueOut[];
    url: PostmanUrlOut;
    auth?: PostmanAuthOut;
    body?: PostmanBodyOut;
  };
}

export interface PostmanFolderOut {
  name: string;
  description?: string;
  item: PostmanItemOut[];
}

export type PostmanItemOut = PostmanRequestItemOut | PostmanFolderOut;

export interface PostmanCollectionOut {
  info: { _postman_id: string; name: string; description?: string; schema: string };
  item: PostmanItemOut[];
}

export interface PostmanEnvironmentOut {
  id: string;
  name: string;
  values: Array<{ key: string; value: string; type: 'default'; enabled: boolean }>;
  _postman_variable_scope: 'environment';
  _postman_exported_at: string;
  _postman_exported_using: string;
}
