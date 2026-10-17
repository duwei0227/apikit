import { describe, expect, it } from 'vitest';
import { createMockResponse, createMockRoute, createMockRule, duplicateMockRoute } from '@/utils/mockFactory';

describe('duplicateMockRoute', () => {
  it('disables the copy, adds -copy to the path and gives everything new ids', () => {
    const route = createMockRoute({
      method: 'GET',
      path: '/orders/:id',
      responses: [createMockResponse({ name: 'Paid', rules: [createMockRule({ key: 'id', value: '1' })] })],
    });
    const copy = duplicateMockRoute(route, [route]);
    expect(copy).toMatchObject({ method: 'GET', path: '/orders/:id-copy', enabled: false });
    expect(copy.id).not.toBe(route.id);
    expect(copy.responses[0].name).toBe('Paid');
    expect(copy.responses[0].id).not.toBe(route.responses[0].id);
    expect(copy.responses[0].rules[0].id).not.toBe(route.responses[0].rules[0].id);
    expect(route.enabled).toBe(true);
  });

  it('numbers the copy when the path is already taken by the same method', () => {
    const route = createMockRoute({ method: 'POST', path: '/orders' });
    const routes = [route, createMockRoute({ method: 'POST', path: '/orders-copy' }), createMockRoute({ method: 'GET', path: '/orders-copy-2' })];
    expect(duplicateMockRoute(route, routes).path).toBe('/orders-copy-2');
    expect(duplicateMockRoute(createMockRoute({ path: '/' }), []).path).toBe('/copy');
  });
});
