import { describe, expect, it } from 'vitest';
import { latestObservedFor, mockPathFromUrl, mockResponseFromObserved, routesFromRequests } from '@/utils/mockFromRequests';

describe('mock routes from requests', () => {
  it('turns request URLs into route paths', () => {
    expect(mockPathFromUrl('{{baseUrl}}/orders/{{orderId}}?expand=items')).toBe('/orders/:orderId');
    expect(mockPathFromUrl('https://api.example.com:8443/v1/orders/:id#x')).toBe('/v1/orders/:id');
    expect(mockPathFromUrl('{{host}}')).toBe('/');
    expect(mockPathFromUrl('/health/')).toBe('/health');
    expect(mockPathFromUrl('{{baseUrl}}/files/{{name}}.json')).toBe('/files/{{name}}.json');
  });

  it('creates one route per method and path', () => {
    const routes = routesFromRequests([
      { name: 'Get order', method: 'GET', url: '{{baseUrl}}/orders/{{id}}' },
      { name: 'Get order again', method: 'GET', url: '{{baseUrl}}/orders/{{orderId}}' },
      { name: 'Delete order', method: 'DELETE', url: '{{baseUrl}}/orders/{{id}}' },
    ]);
    expect(routes.map(({ route }) => `${route.method} ${route.path}`)).toEqual(['GET /orders/:id', 'GET /orders/:orderId', 'DELETE /orders/:id']);
    expect(routes[0].route.responses[0]).toMatchObject({ name: 'Get order', isDefault: true, status: 200 });
  });

  it('uses the latest real response for a route', () => {
    const observed = [
      { method: 'GET', url: 'https://api.example.com/orders/7?x=1', status: 404, headers: {}, body: 'new' },
      { method: 'GET', url: 'https://api.example.com/orders/3', status: 200, headers: {}, body: 'old' },
      { method: 'POST', url: 'https://api.example.com/orders', status: 201, headers: {}, body: 'created' },
    ];
    expect(latestObservedFor(observed, 'GET', '/orders/:id')?.body).toBe('new');
    expect(latestObservedFor(observed, 'POST', '/orders')?.status).toBe(201);
    expect(latestObservedFor(observed, 'PUT', '/orders/:id')).toBeUndefined();
  });

  it('keeps only the content type unless asked to keep all headers', () => {
    const response = { method: 'GET', url: '/x', status: 200, headers: { 'Content-Type': 'text/csv', 'Content-Length': '9', 'X-Trace': 't' }, body: 'a,b' };
    expect(mockResponseFromObserved(response, 'CSV')).toMatchObject({
      name: 'CSV', status: 200, bodyMode: 'text', body: 'a,b', headers: [{ key: 'Content-Type', value: 'text/csv', enabled: true }],
    });
    expect(mockResponseFromObserved(response, 'CSV', true).headers.map(header => header.key)).toEqual(['Content-Type', 'X-Trace']);
    expect(mockResponseFromObserved({ ...response, headers: { 'content-type': 'application/json' } }, 'J')).toMatchObject({ bodyMode: 'json', headers: [] });
  });
});
