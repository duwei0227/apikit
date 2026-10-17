// OpenAPI 3.x / Swagger 2.0 文档转换为 ApiKit Collection。
// 只解析文档内部的 $ref（#/...），外部文件引用保留为空并记录警告。

import type {
  AuthConfig,
  Collection,
  Environment,
  EnvironmentVariable,
  Folder,
  FormDataItem,
  HttpMethod,
  KeyValue,
  MockResponse,
  MockRoute,
  Request,
  RequestBody,
  RequestReference,
} from '@/types/models';
import { generateId } from '@/utils/id-generator';
import { createMockResponse, createMockRoute } from '@/utils/mockFactory';

export interface OpenApiImportResult {
  version: string;
  collection: Collection;
  requests: Request[];
  environment: Environment;
  warnings: string[];
}

const HTTP_METHODS: Record<string, HttpMethod> = {
  get: 'GET',
  post: 'POST',
  put: 'PUT',
  delete: 'DELETE',
  patch: 'PATCH',
  head: 'HEAD',
  options: 'OPTIONS',
};

const MAX_SAMPLE_DEPTH = 8;

/** 文档中的对象：外部 JSON / YAML，字段按需检查 */
type JsonObject = Record<string, unknown>;

/** 已经确认 name 是字符串的参数对象 */
type Parameter = JsonObject & { name: string };

const isObject = (value: unknown): value is JsonObject => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

/** 是对象时返回它，否则返回 undefined，便于逐层读取 */
const obj = (value: unknown): JsonObject | undefined => (isObject(value) ? value : undefined);

export const isOpenApiDocument = (data: unknown): data is JsonObject => (
  isObject(data)
  && isObject(data.paths)
  && ((typeof data.openapi === 'string' && data.openapi.startsWith('3')) || String(data.swagger) === '2.0')
);

export const fromOpenApiDocument = (doc: JsonObject): OpenApiImportResult => new OpenApiConverter(doc).convert();

export interface OpenApiMockResult {
  title: string;
  routes: MockRoute[];
  warnings: string[];
}

/** 每个操作一条 Mock 路由，文档中的每个响应一个 Mock 响应；第一个 2xx 响应为默认 */
export const mockRoutesFromOpenApiDocument = (doc: JsonObject): OpenApiMockResult => new OpenApiConverter(doc).mockRoutes();

class OpenApiConverter {
  private readonly doc: JsonObject;
  private readonly isSwagger2: boolean;
  private readonly warningCounts = new Map<string, number>();
  private readonly variables = new Map<string, string>();

  constructor(doc: JsonObject) {
    this.doc = doc;
    this.isSwagger2 = String(doc.swagger) === '2.0';
  }

  convert(): OpenApiImportResult {
    const collectionId = generateId();
    const now = new Date().toISOString();
    const info = obj(this.doc.info);
    const title = typeof info?.title === 'string' && info.title.trim()
      ? info.title.trim()
      : 'OpenAPI';

    const baseUrl = this.baseUrl();
    this.variables.set('baseUrl', baseUrl);
    if (!baseUrl) this.warn('No server URL in the document; set baseUrl in the environment');

    const folderIds = new Map<string, string>();
    const folderRequests = new Map<string, RequestReference[]>();
    const rootRequests: RequestReference[] = [];
    const requests: Request[] = [];

    // 先按文档 tags 声明的顺序建文件夹，未声明的 tag 按首次出现的顺序追加
    const tagDescriptions = new Map<string, string>();
    const tags: unknown[] = Array.isArray(this.doc.tags) ? this.doc.tags : [];
    for (const tag of tags) {
      if (!isObject(tag) || typeof tag.name !== 'string') continue;
      folderIds.set(tag.name, generateId());
      folderRequests.set(tag.name, []);
      if (typeof tag.description === 'string') tagDescriptions.set(tag.name, tag.description);
    }

    for (const [path, rawPathItem] of Object.entries(obj(this.doc.paths) ?? {})) {
      const pathItem = this.deref(rawPathItem);
      if (!isObject(pathItem)) continue;

      for (const [methodKey, rawOperation] of Object.entries(pathItem)) {
        const key = methodKey.toLowerCase();
        if (key === 'trace') {
          this.warn('TRACE operations are not supported and were skipped');
          continue;
        }
        const method = HTTP_METHODS[key];
        if (!method || !isObject(rawOperation)) continue;

        const operation = rawOperation;
        const tag = Array.isArray(operation.tags) && typeof operation.tags[0] === 'string'
          ? operation.tags[0]
          : null;
        let folderId: string | undefined;
        if (tag) {
          if (!folderIds.has(tag)) {
            folderIds.set(tag, generateId());
            folderRequests.set(tag, []);
          }
          folderId = folderIds.get(tag);
        }

        const request = this.toRequest(path, method, pathItem, operation, collectionId, folderId, now);
        requests.push(request);
        const target = tag ? folderRequests.get(tag)! : rootRequests;
        target.push({
          id: request.id,
          name: request.name,
          method: request.method,
          url: request.url,
          order: target.length,
        });
      }
    }

    const folders: Folder[] = [];
    for (const [tag, refs] of folderRequests) {
      if (refs.length === 0) continue;
      folders.push({
        id: folderIds.get(tag)!,
        name: tag,
        description: tagDescriptions.get(tag),
        order: folders.length,
        folders: [],
        requests: refs,
      });
    }
    // 根目录请求排在文件夹之后
    rootRequests.forEach((ref, index) => { ref.order = folders.length + index; });

    const environment: Environment = {
      id: generateId(),
      name: `${title} (OpenAPI)`,
      isActive: false,
      variables: [...this.variables].map(([key, value]): EnvironmentVariable => ({ key, value, enabled: true })),
    };

    return {
      version: this.isSwagger2 ? 'Swagger 2.0' : `OpenAPI ${String(this.doc.openapi)}`,
      collection: {
        id: collectionId,
        name: title,
        description: typeof info?.description === 'string' ? info.description : undefined,
        folders,
        requests: rootRequests,
        createdAt: now,
        updatedAt: now,
      },
      requests,
      environment,
      warnings: [...this.warningCounts].map(([message, count]) => (count > 1 ? `${message} (${count})` : message)),
    };
  }

  mockRoutes(): OpenApiMockResult {
    const info = obj(this.doc.info);
    const title = typeof info?.title === 'string' && info.title.trim() ? info.title.trim() : 'OpenAPI';
    const routes: MockRoute[] = [];
    for (const [path, rawPathItem] of Object.entries(obj(this.doc.paths) ?? {})) {
      const pathItem = this.deref(rawPathItem);
      if (!isObject(pathItem)) continue;
      for (const [methodKey, rawOperation] of Object.entries(pathItem)) {
        const method = HTTP_METHODS[methodKey.toLowerCase()];
        if (!method || !isObject(rawOperation)) continue;
        const responses = this.mockResponses(rawOperation);
        routes.push(createMockRoute({ method, path, responses }));
      }
    }
    return {
      title,
      routes,
      warnings: [...this.warningCounts].map(([message, count]) => (count > 1 ? `${message} (${count})` : message)),
    };
  }

  private mockResponses(operation: JsonObject): MockResponse[] {
    const documented = obj(operation.responses) ?? {};
    const codes = Object.keys(documented).filter(code => /^[1-5]\d\d$/.test(code));
    // 只写了 default 时当作 200
    if (codes.length === 0) codes.push('200');
    const defaultCode = codes.find(code => code.startsWith('2')) ?? codes[0];
    return codes.map(code => {
      const response = obj(this.deref(documented[code] ?? documented.default)) ?? {};
      const { body, contentType } = this.mockBody(response);
      const description = typeof response.description === 'string' ? response.description.trim() : '';
      return createMockResponse({
        name: description && description.length <= 60 ? description : `${code} response`,
        status: Number(code),
        headers: contentType && !/json/i.test(contentType) ? [{ key: 'Content-Type', value: contentType, enabled: true }] : [],
        bodyMode: contentType && !/json/i.test(contentType) ? 'text' : 'json',
        body,
        isDefault: code === defaultCode,
      });
    });
  }

  private mockBody(response: JsonObject): { body: string; contentType: string | null } {
    const toText = (value: unknown) => (value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2));
    if (this.isSwagger2) {
      const examples = obj(response.examples) ?? {};
      const jsonExample = Object.entries(examples).find(([type]) => /json/i.test(type));
      if (jsonExample) return { body: toText(jsonExample[1]), contentType: 'application/json' };
      if (response.schema === undefined) return { body: '', contentType: null };
      return { body: toText(this.sample(response.schema, new Set(), 0)), contentType: 'application/json' };
    }
    const content = obj(response.content) ?? {};
    const types = Object.keys(content);
    if (types.length === 0) return { body: '', contentType: null };
    const contentType = types.find(type => /json/i.test(type)) ?? types[0];
    const media = obj(content[contentType]) ?? {};
    const example = media.example !== undefined ? media.example : this.firstExample(media.examples);
    const value = example !== undefined ? example : this.sample(media.schema, new Set(), 0);
    return { body: toText(value), contentType };
  }

  // ---------- 基础 ----------

  private warn(message: string) {
    this.warningCounts.set(message, (this.warningCounts.get(message) || 0) + 1);
  }

  private addVariable(name: string, value: string = '') {
    if (!this.variables.has(name)) this.variables.set(name, value);
  }

  private resolveRef(ref: string): unknown {
    if (!ref.startsWith('#/')) {
      this.warn('External $ref references are not resolved');
      return undefined;
    }
    let target: unknown = this.doc;
    for (const segment of ref.slice(2).split('/')) {
      const key = decodeURIComponent(segment).replace(/~1/g, '/').replace(/~0/g, '~');
      if (!isObject(target) && !Array.isArray(target)) return undefined;
      target = (target as Record<string, unknown>)[key];
    }
    return target;
  }

  /** 解开对象顶层的 $ref 链（有环时停止）。 */
  private deref(value: unknown, seen: Set<string> = new Set()): unknown {
    let current = value;
    while (isObject(current) && typeof current.$ref === 'string') {
      if (seen.has(current.$ref)) return undefined;
      seen.add(current.$ref);
      current = this.resolveRef(current.$ref);
    }
    return current;
  }

  private baseUrl(): string {
    if (this.isSwagger2) {
      const host = typeof this.doc.host === 'string' ? this.doc.host : '';
      const basePath = typeof this.doc.basePath === 'string' ? this.doc.basePath : '';
      const scheme = Array.isArray(this.doc.schemes) && this.doc.schemes.includes('https')
        ? 'https'
        : (Array.isArray(this.doc.schemes) && typeof this.doc.schemes[0] === 'string' ? this.doc.schemes[0] : 'https');
      const url = host ? `${scheme}://${host}${basePath}` : basePath;
      return url.replace(/\/+$/, '');
    }

    const server = Array.isArray(this.doc.servers) ? this.doc.servers[0] : null;
    if (!isObject(server) || typeof server.url !== 'string') return '';
    const variables = obj(server.variables) ?? {};
    return server.url
      .replace(/\{([^}]+)\}/g, (match: string, name: string) => {
        const defaultValue = obj(variables[name])?.default;
        return defaultValue !== undefined ? String(defaultValue) : match;
      })
      .replace(/\/+$/, '');
  }

  // ---------- 请求 ----------

  private toRequest(
    path: string,
    method: HttpMethod,
    pathItem: JsonObject,
    operation: JsonObject,
    collectionId: string,
    folderId: string | undefined,
    now: string,
  ): Request {
    const parameters = this.mergeParameters(pathItem.parameters, operation.parameters);
    const params: KeyValue[] = [];
    const headers: KeyValue[] = [];
    let body: RequestBody = { type: 'none', raw: '', formData: [], urlencoded: [] };
    const swaggerFormParams: Parameter[] = [];

    for (const parameter of parameters) {
      const value = this.parameterValue(parameter);
      switch (parameter.in) {
        case 'path':
          this.addVariable(parameter.name, value);
          break;
        case 'query':
          params.push({ key: parameter.name, value, enabled: parameter.required === true });
          break;
        case 'header':
          headers.push({ key: parameter.name, value, enabled: parameter.required === true });
          break;
        case 'cookie':
          this.warn('Cookie parameters are not imported');
          break;
        case 'body':
          body = this.jsonBody(parameter.schema, parameter['x-example']);
          break;
        case 'formData':
          swaggerFormParams.push(parameter);
          break;
      }
    }

    if (this.isSwagger2) {
      if (swaggerFormParams.length > 0) body = this.swaggerFormBody(operation, swaggerFormParams);
    } else if (operation.requestBody) {
      body = this.openApi3Body(this.deref(operation.requestBody));
    }

    const auth = this.applySecurity(operation, headers, params);
    const url = `{{baseUrl}}${path.replace(/\{([^}]+)\}/g, '{{$1}}')}`;

    return {
      id: generateId(),
      name: this.operationName(operation, method, path),
      method,
      url,
      params,
      headers,
      body,
      auth,
      tests: {
        statusCodeTests: [{
          enabled: true,
          operator: 'equals',
          expectedValue: this.successStatus(operation.responses),
          description: '',
        }],
        jsonFieldTests: [],
        globalVariables: [],
      },
      collectionId,
      folderId,
      createdAt: now,
      updatedAt: now,
    };
  }

  private operationName(operation: JsonObject, method: HttpMethod, path: string): string {
    for (const candidate of [operation.summary, operation.operationId]) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
    return `${method} ${path}`;
  }

  /** 路径级参数与操作级参数合并，同名同位置时操作级覆盖。 */
  private mergeParameters(pathLevel: unknown, operationLevel: unknown): Parameter[] {
    const merged = new Map<string, Parameter>();
    for (const list of [pathLevel, operationLevel]) {
      for (const raw of Array.isArray(list) ? list : []) {
        const parameter = this.deref(raw);
        if (!isObject(parameter) || typeof parameter.name !== 'string') continue;
        merged.set(`${String(parameter.in)}:${parameter.name}`, parameter as Parameter);
      }
    }
    return [...merged.values()];
  }

  private parameterValue(parameter: JsonObject): string {
    const schema = obj(this.deref(parameter.schema)) ?? parameter;
    const itemEnum = obj(schema.items)?.enum;
    const candidates = [
      parameter.example,
      parameter['x-example'],
      this.firstExample(parameter.examples),
      schema.example,
      schema.default,
      Array.isArray(schema.enum) ? schema.enum[0] : undefined,
      Array.isArray(itemEnum) ? itemEnum[0] : undefined,
    ];
    const value = candidates.find(item => item !== undefined && item !== null);
    return this.stringifyValue(value);
  }

  private firstExample(examples: unknown): unknown {
    if (!isObject(examples)) return undefined;
    const first = this.deref(Object.values(examples)[0]);
    return isObject(first) ? first.value : undefined;
  }

  private stringifyValue(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return value.map(item => this.stringifyValue(item)).join(',');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  private successStatus(responses: unknown): string {
    const codes = isObject(responses) ? Object.keys(responses) : [];
    const exact = codes.find(code => /^2\d\d$/.test(code));
    return exact || '200';
  }

  // ---------- Body ----------

  private openApi3Body(requestBody: unknown): RequestBody {
    const empty: RequestBody = { type: 'none', raw: '', formData: [], urlencoded: [] };
    const content = obj(obj(requestBody)?.content) ?? {};
    const types = Object.keys(content);
    if (types.length === 0) return empty;

    const pick = (test: (type: string) => boolean) => types.find(type => test(type.toLowerCase()));
    const contentType = pick(type => type === 'application/json' || /\+json$|\/json$/.test(type))
      || pick(type => type === 'application/x-www-form-urlencoded')
      || pick(type => type === 'multipart/form-data')
      || pick(type => /xml/.test(type))
      || pick(type => type.startsWith('text/'))
      || types[0];
    const media = obj(content[contentType]) ?? {};
    const lower = contentType.toLowerCase();
    const explicitExample = media.example !== undefined ? media.example : this.firstExample(media.examples);

    if (lower === 'application/x-www-form-urlencoded' || lower === 'multipart/form-data') {
      const fields = this.schemaFields(media.schema, explicitExample);
      if (fields.length === 0) return empty;
      if (lower === 'application/x-www-form-urlencoded') {
        return {
          ...empty,
          type: 'x-www-form-urlencoded',
          urlencoded: fields.map(field => ({ key: field.key, value: field.value, enabled: field.required })),
        };
      }
      return {
        ...empty,
        type: 'form-data',
        formData: fields.map((field): FormDataItem => ({
          key: field.key,
          value: field.isFile ? '' : field.value,
          type: field.isFile ? 'file' : 'text',
          enabled: field.required,
        })),
      };
    }

    if (/json/.test(lower)) return this.jsonBody(media.schema, explicitExample);
    if (/xml/.test(lower)) {
      return { ...empty, type: 'xml', raw: typeof explicitExample === 'string' ? explicitExample : '' };
    }
    if (lower.startsWith('text/')) {
      return { ...empty, type: 'text', raw: explicitExample !== undefined ? this.stringifyValue(explicitExample) : '' };
    }
    if (lower === 'application/octet-stream') return { ...empty, type: 'binary' };

    this.warn(`Request body type ${contentType} is not supported`);
    return empty;
  }

  private jsonBody(schema: unknown, example?: unknown): RequestBody {
    const sample = example !== undefined ? example : this.sample(schema, new Set(), 0);
    return {
      type: 'json',
      raw: sample === undefined ? '' : (typeof sample === 'string' && example !== undefined ? sample : JSON.stringify(sample, null, 2)),
      formData: [],
      urlencoded: [],
    };
  }

  private swaggerFormBody(operation: JsonObject, formParams: Parameter[]): RequestBody {
    const consumes: string[] = Array.isArray(operation.consumes)
      ? operation.consumes
      : (Array.isArray(this.doc.consumes) ? this.doc.consumes : []);
    const multipart = formParams.some(parameter => parameter.type === 'file') || consumes.includes('multipart/form-data');
    const empty: RequestBody = { type: 'none', raw: '', formData: [], urlencoded: [] };

    if (multipart) {
      return {
        ...empty,
        type: 'form-data',
        formData: formParams.map((parameter): FormDataItem => ({
          key: parameter.name,
          value: parameter.type === 'file' ? '' : this.parameterValue(parameter),
          type: parameter.type === 'file' ? 'file' : 'text',
          enabled: parameter.required === true,
        })),
      };
    }
    return {
      ...empty,
      type: 'x-www-form-urlencoded',
      urlencoded: formParams.map(parameter => ({
        key: parameter.name,
        value: this.parameterValue(parameter),
        enabled: parameter.required === true,
      })),
    };
  }

  /** 表单类 body：取对象 schema 的顶层属性作为字段，必填字段默认勾选。 */
  private schemaFields(rawSchema: unknown, example: unknown): Array<{ key: string; value: string; isFile: boolean; required: boolean }> {
    const schema = obj(this.mergedSchema(rawSchema, new Set()));
    const properties = obj(schema?.properties) ?? {};
    const required = new Set<unknown>(Array.isArray(schema?.required) ? schema.required : []);
    return Object.entries(properties).map(([key, rawProperty]) => {
      const property = obj(this.deref(rawProperty)) ?? {};
      const isFile = property.format === 'binary' || property.format === 'base64'
        || (property.type === 'array' && obj(this.deref(property.items))?.format === 'binary');
      const value = isObject(example) && example[key] !== undefined
        ? example[key]
        : this.sample(property, new Set(), 1);
      return { key, value: isFile ? '' : this.stringifyValue(value), isFile, required: required.has(key) };
    });
  }

  // ---------- Schema 示例 ----------

  /** 解开 $ref 并合并 allOf，返回一个普通 schema。 */
  private mergedSchema(rawSchema: unknown, seen: Set<string>): unknown {
    const schema = this.deref(rawSchema, seen);
    if (!isObject(schema) || !Array.isArray(schema.allOf)) return schema;

    const properties: JsonObject = { ...(obj(schema.properties) ?? {}) };
    let required: unknown[] | undefined = Array.isArray(schema.required) ? schema.required : undefined;
    const merged: JsonObject = { ...schema, properties };
    delete merged.allOf;
    for (const part of schema.allOf) {
      const resolved = this.mergedSchema(part, new Set(seen));
      if (!isObject(resolved)) continue;
      if (!merged.type && resolved.type) merged.type = resolved.type;
      Object.assign(properties, obj(resolved.properties) ?? {});
      if (Array.isArray(resolved.required)) required = [...(required || []), ...resolved.required];
    }
    if (required) merged.required = required;
    return merged;
  }

  private schemaType(schema: JsonObject): string | undefined {
    if (Array.isArray(schema.type)) {
      const type: unknown = schema.type.find((item: unknown) => item !== 'null');
      return typeof type === 'string' ? type : undefined;
    }
    if (typeof schema.type === 'string') return schema.type;
    if (isObject(schema.properties)) return 'object';
    if (schema.items) return 'array';
    return undefined;
  }

  private sample(rawSchema: unknown, seen: Set<string>, depth: number): unknown {
    if (depth > MAX_SAMPLE_DEPTH) return undefined;
    // 每条分支单独记录访问过的 $ref，兄弟属性可以引用同一个 schema，自引用的环会在这里截断
    const branchSeen = new Set(seen);
    const schema = this.mergedSchema(rawSchema, branchSeen);
    if (!isObject(schema)) return undefined;

    if (schema.example !== undefined) return schema.example;
    if (Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0];
    if (schema.default !== undefined) return schema.default;
    if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
    if (schema.const !== undefined) return schema.const;

    for (const key of ['oneOf', 'anyOf']) {
      const options = schema[key];
      if (Array.isArray(options) && options.length > 0) {
        return this.sample(options[0], branchSeen, depth + 1);
      }
    }

    switch (this.schemaType(schema)) {
      case 'object': {
        const result: JsonObject = {};
        for (const [key, property] of Object.entries(obj(schema.properties) ?? {})) {
          const value = this.sample(property, branchSeen, depth + 1);
          if (value !== undefined) result[key] = value;
        }
        return result;
      }
      case 'array': {
        const item = this.sample(schema.items, branchSeen, depth + 1);
        return item === undefined ? [] : [item];
      }
      case 'integer':
      case 'number':
        return 0;
      case 'boolean':
        return true;
      case 'string':
        return this.stringSample(schema.format);
      default:
        return undefined;
    }
  }

  private stringSample(format: unknown): string {
    switch (format) {
      case 'date': return '2024-01-01';
      case 'date-time': return '2024-01-01T00:00:00Z';
      case 'email': return 'user@example.com';
      case 'uuid': return '00000000-0000-0000-0000-000000000000';
      case 'uri':
      case 'url': return 'https://example.com';
      default: return 'string';
    }
  }

  // ---------- 鉴权 ----------

  private securitySchemes(): JsonObject {
    const schemes = this.isSwagger2 ? this.doc.securityDefinitions : obj(this.doc.components)?.securitySchemes;
    return obj(schemes) ?? {};
  }

  /** 取第一个安全要求中的第一个方案；apiKey 写入 header 或 query，返回请求的 Auth 配置。 */
  private applySecurity(operation: JsonObject, headers: KeyValue[], params: KeyValue[]): AuthConfig {
    const none: AuthConfig = { type: 'none', token: '', username: '', password: '' };
    const requirements = Array.isArray(operation.security) ? operation.security : this.doc.security;
    if (!Array.isArray(requirements) || requirements.length === 0) return none;

    const name = isObject(requirements[0]) ? Object.keys(requirements[0])[0] : undefined;
    if (!name) return none;
    const scheme = this.deref(this.securitySchemes()[name]);
    if (!isObject(scheme)) return none;

    const httpScheme = typeof scheme.scheme === 'string' ? scheme.scheme.toLowerCase() : '';
    if (scheme.type === 'http' && httpScheme === 'bearer') {
      this.addVariable('token');
      return { ...none, type: 'bearer', token: '{{token}}' };
    }
    if ((scheme.type === 'http' && httpScheme === 'basic') || scheme.type === 'basic') {
      this.addVariable('username');
      this.addVariable('password');
      return { ...none, type: 'basic', username: '{{username}}', password: '{{password}}' };
    }
    if (scheme.type === 'apiKey' && typeof scheme.name === 'string') {
      const keyName = scheme.name;
      const row = { key: keyName, value: '{{apiKey}}', enabled: true };
      if (scheme.in === 'header') {
        this.addVariable('apiKey');
        if (!headers.some(header => header.key.toLowerCase() === keyName.toLowerCase())) headers.push(row);
      } else if (scheme.in === 'query') {
        this.addVariable('apiKey');
        if (!params.some(param => param.key === keyName)) params.push(row);
      } else {
        this.warn('Cookie API key auth is not imported');
      }
      return none;
    }
    if (scheme.type === 'oauth2' || scheme.type === 'openIdConnect') {
      this.warn('OAuth2 / OpenID Connect auth is not imported');
      return none;
    }
    this.warn(`Auth scheme "${name}" is not supported`);
    return none;
  }
}
