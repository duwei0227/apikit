import { describe, it, expect, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';

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
import { isOpenApiDocument } from '@/services/import-export/openapi';

const service = new ImportExportService();

const openApi3 = {
  openapi: '3.0.3',
  info: { title: 'Petstore', description: 'Pets API' },
  servers: [{ url: 'https://{env}.example.com/v1/', variables: { env: { default: 'api' } } }],
  tags: [{ name: 'store', description: 'Orders' }, { name: 'pet' }],
  security: [{ bearerAuth: [] }],
  paths: {
    '/pets': {
      get: {
        tags: ['pet'],
        summary: 'List pets',
        parameters: [
          { name: 'limit', in: 'query', required: true, schema: { type: 'integer', default: 20 } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['available', 'sold'] } },
          { name: 'X-Trace', in: 'header', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'ok' } },
      },
      post: {
        tags: ['pet'],
        operationId: 'createPet',
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
        },
        responses: { 201: { description: 'created' } },
      },
    },
    '/pets/{petId}': {
      parameters: [{ $ref: '#/components/parameters/PetId' }],
      delete: { tags: ['pet'], security: [], responses: { 204: { description: 'gone' } } },
    },
    '/store/orders': {
      post: {
        tags: ['store'],
        security: [{ apiKey: [] }],
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: { note: { type: 'string', example: 'hi' }, file: { type: 'string', format: 'binary' } },
              },
            },
          },
        },
        responses: { default: { description: 'ok' } },
      },
    },
    '/health': {
      get: {
        security: [{ oauth: [] }],
        // 空表单 body（Stripe 的 GET 接口常见）不生成 body
        requestBody: { content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', properties: {} } } } },
        responses: { '2XX': { description: 'ok' } },
      },
      trace: { responses: {} },
    },
  },
  components: {
    parameters: {
      PetId: { name: 'petId', in: 'path', required: true, schema: { type: 'integer', example: 7 } },
    },
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer' },
      apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      oauth: { type: 'oauth2', flows: {} },
    },
    schemas: {
      Pet: {
        allOf: [
          { $ref: '#/components/schemas/Base' },
          {
            type: 'object',
            properties: {
              name: { type: 'string' },
              born: { type: 'string', format: 'date' },
              tags: { type: 'array', items: { type: 'string' } },
              parent: { $ref: '#/components/schemas/Pet' },
            },
          },
        ],
      },
      Base: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  },
};

const findRequest = (bundle: any, name: string) => {
  const request = bundle.requests.find((item: any) => item.name === name);
  expect(request, name).toBeTruthy();
  return request;
};

describe('OpenAPI import', () => {
  it('detects OpenAPI 3 and Swagger 2 documents only', () => {
    expect(isOpenApiDocument(openApi3)).toBe(true);
    expect(isOpenApiDocument({ swagger: '2.0', paths: {} })).toBe(true);
    expect(isOpenApiDocument({ info: { name: 'x' }, item: [] })).toBe(false);
    expect(isOpenApiDocument({ openapi: '3.0.0' })).toBe(false);
  });

  it('builds a collection grouped by tag with {{baseUrl}} URLs and an environment', () => {
    const bundle = service.parseImportData(openApi3);

    expect(bundle.source).toBe('openapi');
    expect(bundle.version).toBe('OpenAPI 3.0.3');
    expect(bundle.collections).toHaveLength(1);
    const [collection] = bundle.collections;
    expect(collection.name).toBe('Petstore');
    expect(collection.description).toBe('Pets API');
    // 文件夹顺序按文档 tags 声明，根目录请求排在文件夹之后
    expect(collection.folders.map(folder => folder.name)).toEqual(['store', 'pet']);
    expect(collection.folders[0].description).toBe('Orders');
    expect(collection.folders[1].requests.map(ref => ref.name)).toEqual(['List pets', 'createPet', 'DELETE /pets/{petId}']);
    expect(collection.requests.map(ref => ref.name)).toEqual(['GET /health']);
    expect(collection.requests[0].order).toBe(2);
    expect(bundle.requests.every(request => request.collectionId === collection.id)).toBe(true);

    const [environment] = bundle.environments!;
    expect(environment.name).toBe('Petstore (OpenAPI)');
    const variables = Object.fromEntries(environment.variables.map(variable => [variable.key, variable.value]));
    expect(variables).toEqual({ baseUrl: 'https://api.example.com/v1', token: '', petId: '7', apiKey: '' });
  });

  it('maps parameters, path variables and success status', () => {
    const bundle = service.parseImportData(openApi3);

    const list = findRequest(bundle, 'List pets');
    expect(list.method).toBe('GET');
    expect(list.url).toBe('{{baseUrl}}/pets');
    expect(list.params).toEqual([
      { key: 'limit', value: '20', enabled: true },
      { key: 'status', value: 'available', enabled: false },
    ]);
    expect(list.headers).toEqual([{ key: 'X-Trace', value: '', enabled: false }]);
    expect(list.auth).toMatchObject({ type: 'bearer', token: '{{token}}' });
    expect(list.tests.statusCodeTests[0].expectedValue).toBe('200');

    const remove = findRequest(bundle, 'DELETE /pets/{petId}');
    expect(remove.url).toBe('{{baseUrl}}/pets/{{petId}}');
    expect(remove.auth.type).toBe('none');
    expect(remove.tests.statusCodeTests[0].expectedValue).toBe('204');

    const health = findRequest(bundle, 'GET /health');
    expect(health.tests.statusCodeTests[0].expectedValue).toBe('200');
    expect(health.body.type).toBe('none');
  });

  it('generates a JSON body from schema refs, allOf and cycles', () => {
    const create = findRequest(service.parseImportData(openApi3), 'createPet');
    expect(create.body.type).toBe('json');
    const body = JSON.parse(create.body.raw);
    expect(body).toMatchObject({ id: 0, name: 'string', born: '2024-01-01', tags: ['string'] });
    // 自引用在第二层截断
    expect(body.parent).toBeUndefined();
    expect(create.tests.statusCodeTests[0].expectedValue).toBe('201');
  });

  it('maps multipart bodies and API key auth', () => {
    const order = findRequest(service.parseImportData(openApi3), 'POST /store/orders');
    expect(order.body.type).toBe('form-data');
    expect(order.body.formData).toEqual([
      { key: 'note', value: 'hi', type: 'text', enabled: false },
      { key: 'file', value: '', type: 'file', enabled: true },
    ]);
    expect(order.headers).toContainEqual({ key: 'X-API-Key', value: '{{apiKey}}', enabled: true });
    expect(order.auth.type).toBe('none');
  });

  it('reports what could not be imported', () => {
    const { warnings } = service.parseImportData(openApi3);
    expect(warnings).toContain('OAuth2 / OpenID Connect auth is not imported');
    expect(warnings).toContain('TRACE operations are not supported and were skipped');
  });

  it('converts Swagger 2.0 documents', () => {
    const bundle = service.parseImportData({
      swagger: '2.0',
      info: { title: 'Legacy' },
      host: 'legacy.example.com',
      basePath: '/api',
      schemes: ['http', 'https'],
      securityDefinitions: { basic: { type: 'basic' } },
      security: [{ basic: [] }],
      definitions: { User: { type: 'object', properties: { email: { type: 'string', format: 'email' } } } },
      paths: {
        '/users': {
          post: {
            summary: 'Create user',
            parameters: [{ name: 'body', in: 'body', schema: { $ref: '#/definitions/User' } }],
            responses: { 201: {} },
          },
        },
        '/login': {
          post: {
            summary: 'Login',
            consumes: ['application/x-www-form-urlencoded'],
            parameters: [
              { name: 'user', in: 'formData', type: 'string', required: true },
              { name: 'remember', in: 'formData', type: 'boolean', default: true },
            ],
            responses: { 200: {} },
          },
        },
      },
    });

    expect(bundle.version).toBe('Swagger 2.0');
    expect(bundle.environments![0].variables[0]).toMatchObject({ key: 'baseUrl', value: 'https://legacy.example.com/api' });

    const create = findRequest(bundle, 'Create user');
    expect(JSON.parse(create.body.raw)).toEqual({ email: 'user@example.com' });
    expect(create.auth).toMatchObject({ type: 'basic', username: '{{username}}', password: '{{password}}' });

    const login = findRequest(bundle, 'Login');
    expect(login.body.type).toBe('x-www-form-urlencoded');
    expect(login.body.urlencoded).toEqual([
      { key: 'user', value: '', enabled: true },
      { key: 'remember', value: 'true', enabled: false },
    ]);
  });

  it('accepts documents parsed from YAML', () => {
    const doc = parseYaml(`
openapi: 3.1.0
info:
  title: YAML API
paths:
  /items/{id}:
    get:
      summary: Get item
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: [string, "null"]
      responses:
        "200":
          description: ok
`);
    const bundle = service.parseImportData(doc);
    expect(bundle.collections[0].name).toBe('YAML API');
    expect(findRequest(bundle, 'Get item').url).toBe('{{baseUrl}}/items/{{id}}');
    expect(bundle.warnings).toContain('No server URL in the document; set baseUrl in the environment');
  });

  it('still recognises Postman collections first', () => {
    const bundle = service.parseImportData({ info: { name: 'P' }, item: [] });
    expect(bundle.source).toBe('postman');
  });
});

describe('OpenAPI mock routes', () => {
  it('creates one route per operation and one response per documented status', async () => {
    const { mockRoutesFromOpenApiDocument } = await import('@/services/import-export/openapi');
    const result = mockRoutesFromOpenApiDocument({
      openapi: '3.0.3',
      info: { title: 'Shop' },
      paths: {
        '/orders/{id}': {
          get: {
            responses: {
              200: {
                description: 'The order',
                content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'integer' }, status: { enum: ['paid', 'open'] } } } } },
              },
              404: { description: 'Not found', content: { 'application/json': { example: { error: 'not_found' } } } },
            },
          },
          delete: { responses: { 204: { description: 'Deleted' } } },
        },
        '/health': { get: { responses: { default: { description: 'OK', content: { 'text/plain': { example: 'ok' } } } } } },
      },
    });
    expect(result.title).toBe('Shop');
    expect(result.routes.map(route => `${route.method} ${route.path}`)).toEqual(['GET /orders/{id}', 'DELETE /orders/{id}', 'GET /health']);
    const [order, removed, health] = result.routes;
    expect(order.responses.map(response => [response.status, response.name, response.isDefault])).toEqual([[200, 'The order', true], [404, 'Not found', false]]);
    expect(JSON.parse(order.responses[0].body)).toEqual({ id: 0, status: 'paid' });
    expect(JSON.parse(order.responses[1].body)).toEqual({ error: 'not_found' });
    expect(removed.responses[0]).toMatchObject({ status: 204, body: '' });
    expect(health.responses[0]).toMatchObject({
      status: 200, bodyMode: 'text', body: 'ok', headers: [{ key: 'Content-Type', value: 'text/plain', enabled: true }],
    });
  });

  it('reads Swagger 2.0 examples and schemas', async () => {
    const { mockRoutesFromOpenApiDocument } = await import('@/services/import-export/openapi');
    const result = mockRoutesFromOpenApiDocument({
      swagger: '2.0',
      info: { title: 'Pets' },
      definitions: { Pet: { type: 'object', properties: { name: { type: 'string' } } } },
      paths: {
        '/pets': {
          get: { responses: { 200: { description: 'ok', schema: { type: 'array', items: { $ref: '#/definitions/Pet' } } } } },
          post: { responses: { 201: { description: 'created', examples: { 'application/json': { name: 'Rex' } } } } },
        },
      },
    });
    expect(JSON.parse(result.routes[0].responses[0].body)).toEqual([{ name: 'string' }]);
    expect(JSON.parse(result.routes[1].responses[0].body)).toEqual({ name: 'Rex' });
  });
});
