import { describe, expect, it } from 'vitest';
import type { MockResponse, MockRoute, MockRule } from '@/types/models';
import {
  buildMockRequestData,
  evaluateMockRule,
  findMockRoute,
  matchMockPath,
  mockExamplePath,
  splitMockRequestTarget,
  normalizeMockPath,
  selectMockResponse,
} from '@/utils/mockMatching';

const response = (name: string, status: number, extra: Partial<MockResponse> = {}): MockResponse => ({
  id: name,
  name,
  status,
  headers: [],
  bodyMode: 'json',
  body: '',
  delayMs: null,
  isDefault: false,
  ruleLogic: 'all',
  rules: [],
  ...extra,
});

const rule = (source: MockRule['source'], key: string, operator: MockRule['operator'], value = ''): MockRule => ({
  id: `${source}-${key}`, source, key, operator, value,
});

const route = (method: MockRoute['method'], path: string, responses: MockResponse[] = [], enabled = true): MockRoute => ({
  id: `${method} ${path}`, method, path, enabled, responses,
});

const request = (method: string, path: string, query = '', headers: Array<[string, string]> = [], body = '') => (
  buildMockRequestData({ method, path, query, headers, body })
);

describe('mock route matching', () => {
  it('normalizes paths', () => {
    expect(normalizeMockPath('orders/')).toBe('/orders');
    expect(normalizeMockPath('/orders//1?x=1')).toBe('/orders/1');
    expect(normalizeMockPath('')).toBe('/');
  });

  it('matches path parameters and wildcards', () => {
    expect(matchMockPath('/orders/:id', '/orders/42')).toEqual({ id: '42' });
    expect(matchMockPath('/orders/{id}/items/:sku', '/orders/7/items/A%201')).toEqual({ id: '7', sku: 'A 1' });
    expect(matchMockPath('/files/*', '/files/readme')).toEqual({});
    expect(matchMockPath('/orders/:id', '/orders')).toBeNull();
    expect(matchMockPath('/orders', '/Orders')).toBeNull();
    expect(matchMockPath('/orders/', '/orders')).toEqual({});
  });

  it('fills path parameters with an example value', () => {
    expect(mockExamplePath('/orders/:id/items/{sku}/{{ tag }}/*')).toBe('/orders/1/items/1/1/1');
    expect(mockExamplePath('orders/')).toBe('/orders');
    expect(mockExamplePath('/')).toBe('/');
  });

  it('splits a preview request into path and query, dropping the scheme and host', () => {
    expect(splitMockRequestTarget('/ttt/5?page=2')).toEqual({ path: '/ttt/5', query: 'page=2' });
    expect(splitMockRequestTarget('http://127.0.0.1:3001/ttt/7?a=1#top')).toEqual({ path: '/ttt/7', query: 'a=1' });
    expect(splitMockRequestTarget('127.0.0.1:3001/ttt/8')).toEqual({ path: '/ttt/8', query: '' });
    expect(splitMockRequestTarget('ttt/9')).toEqual({ path: 'ttt/9', query: '' });
  });

  it('reads {{id}} path segments as the parameter id', () => {
    expect(matchMockPath('/orders/{{id}}', '/orders/42')).toEqual({ id: '42' });
    expect(matchMockPath('/orders/{{ id }}/items/{sku}', '/orders/7/items/A')).toEqual({ id: '7', sku: 'A' });
  });

  it('prefers the route with more static segments and skips disabled routes', () => {
    const routes = [
      route('GET', '/orders/:id'),
      route('GET', '/orders/latest'),
      route('POST', '/orders/:id'),
      route('GET', '/health', [], false),
    ];
    expect(findMockRoute(routes, 'GET', '/orders/latest')?.route.path).toBe('/orders/latest');
    expect(findMockRoute(routes, 'get', '/orders/9')).toMatchObject({ route: { path: '/orders/:id', method: 'GET' }, params: { id: '9' } });
    expect(findMockRoute(routes, 'DELETE', '/orders/9')).toBeNull();
    expect(findMockRoute(routes, 'GET', '/health')).toBeNull();
  });
});

describe('mock rules', () => {
  it('reads values from each part of the request', () => {
    const req = request('POST', '/orders', 'status=paid&page=2', [
      ['Authorization', 'Bearer abc'],
      ['Cookie', 'sid=s1; theme=dark'],
    ], '{"items":[{"sku":"A1"}],"total":3}');
    req.params = { id: '0' };
    expect(evaluateMockRule(rule('query', 'status', 'equals', 'paid'), req)).toBe(true);
    expect(evaluateMockRule(rule('header', 'authorization', 'contains', 'Bearer'), req)).toBe(true);
    expect(evaluateMockRule(rule('cookie', 'theme', 'equals', 'dark'), req)).toBe(true);
    expect(evaluateMockRule(rule('path', 'id', 'equals', '0'), req)).toBe(true);
    expect(evaluateMockRule(rule('body', '$.items[0].sku', 'equals', 'A1'), req)).toBe(true);
    expect(evaluateMockRule(rule('body', 'total', 'notEquals', '3'), req)).toBe(false);
    expect(evaluateMockRule(rule('query', 'page', 'regex', '^\\d+$'), req)).toBe(true);
    expect(evaluateMockRule(rule('query', 'page', 'regex', '('), req)).toBe(false);
    expect(evaluateMockRule(rule('query', 'missing', 'notExists'), req)).toBe(true);
    expect(evaluateMockRule(rule('header', 'x-trace', 'exists'), req)).toBe(false);
  });
});

describe('mock response selection', () => {
  const unauthorized = response('Not signed in', 401, { rules: [rule('header', 'authorization', 'notExists')] });
  const paged = response('Paged orders', 200, {
    ruleLogic: 'any',
    rules: [rule('query', 'page', 'exists'), rule('query', 'pageSize', 'exists')],
  });
  const empty = response('Empty list', 200, { isDefault: true });
  const orders = route('GET', '/orders', [unauthorized, paged, empty]);
  const signedIn: Array<[string, string]> = [['authorization', 'Bearer t']];

  it('returns the first response whose rules match, then the default', () => {
    expect(selectMockResponse(orders, request('GET', '/orders'))).toEqual({ response: unauthorized, pickedBy: 'rules' });
    expect(selectMockResponse(orders, request('GET', '/orders', 'pageSize=5', signedIn))).toEqual({ response: paged, pickedBy: 'rules' });
    expect(selectMockResponse(orders, request('GET', '/orders', '', signedIn))).toEqual({ response: empty, pickedBy: 'default' });
  });

  it('lets the caller pick a response by name or status code', () => {
    expect(selectMockResponse(orders, request('GET', '/orders', '', [['X-Mock-Response-Name', 'paged ORDERS']]))?.response).toBe(paged);
    expect(selectMockResponse(orders, request('GET', '/orders', '', [...signedIn, ['x-mock-response-code', '401']]))?.response).toBe(unauthorized);
    // 找不到时按规则选择
    expect(selectMockResponse(orders, request('GET', '/orders', '', [...signedIn, ['x-mock-response-code', '500']]))?.response).toBe(empty);
  });

  it('falls back to the first response without rules, or none', () => {
    const noDefault = route('GET', '/a', [paged, response('Plain', 200)]);
    expect(selectMockResponse(noDefault, request('GET', '/a'))?.response.name).toBe('Plain');
    expect(selectMockResponse(route('GET', '/b', [paged]), request('GET', '/b'))).toBeNull();
  });
});
