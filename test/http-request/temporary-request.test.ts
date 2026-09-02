import { describe, expect, it } from 'vitest';
import {
  createTemporaryRequest,
  createTemporaryRequestFromHistory,
} from '@/utils/temporaryRequest';

describe('temporary request creation', () => {
  it('creates the same unassigned request used by the New Request flow', () => {
    const request = createTemporaryRequest();

    expect(request.name).toBe('Untitled Request');
    expect(request.collectionId).toBeNull();
    expect(request.folderId).toBeNull();
    expect(request.method).toBe('GET');
    expect(request.url).toBe('');
    expect(request.tests.statusCodeTests[0]).toMatchObject({
      enabled: true,
      operator: 'equals',
      expectedValue: '200',
      description: '',
    });
    expect(request.tests.statusCodeTests[0]).not.toHaveProperty('value');
    expect(request.testsConfig).toEqual(request.tests);
  });

  it('restores history request data without assigning a collection', () => {
    const request = createTemporaryRequestFromHistory({
      method: 'POST',
      url: 'https://example.com/orders',
      requestData: {
        method: 'POST',
        url: 'https://example.com/orders',
        headers: { Authorization: 'Bearer token' },
        body: '{"orderId":42}',
      },
    });

    expect(request).toMatchObject({
      name: 'POST /orders',
      method: 'POST',
      url: 'https://example.com/orders',
      collectionId: null,
      folderId: null,
      headers: [
        { key: 'Authorization', value: 'Bearer token', enabled: true },
      ],
      body: {
        type: 'json',
        raw: '{"orderId":42}',
      },
    });
  });

  it('uses a safe name when a history URL is not absolute', () => {
    const request = createTemporaryRequestFromHistory({
      method: 'GET',
      url: 'not a valid absolute url',
      requestData: {},
    });

    expect(request.name).toBe('GET Request');
    expect(request.collectionId).toBeNull();
  });
});
