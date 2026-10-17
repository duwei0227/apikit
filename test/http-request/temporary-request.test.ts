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

const fromHistory = (body: string | null, headers: Record<string, string> = {}, method = 'POST') =>
  createTemporaryRequestFromHistory({ method, url: 'https://example.com/items', requestData: { method, url: 'https://example.com/items', headers, body } });

describe('history request bodies', () => {
  it('TEMP-001 names the request after the method and path and keeps the headers', () => {
    const request = fromHistory(null, { 'X-A': '1' }, 'GET');
    expect(request.name).toBe('GET /items');
    expect(request.collectionId).toBeNull();
    expect(request.headers).toEqual([{ key: 'X-A', value: '1', enabled: true }]);
    expect(request.body.type).toBe('none');
  });

  it('TEMP-002 restores JSON, XML and text bodies by Content-Type', () => {
    expect(fromHistory('{"a":1}', { 'Content-Type': 'application/json' }).body).toMatchObject({ type: 'json', raw: '{"a":1}' });
    expect(fromHistory('<a>1</a>', { 'content-type': 'application/xml' }).body).toMatchObject({ type: 'xml', raw: '<a>1</a>' });
    expect(fromHistory('hello', { 'Content-Type': 'text/plain' }).body).toMatchObject({ type: 'text', raw: 'hello' });
    // 文本内容恰好是合法 JSON 时仍按 Content-Type
    expect(fromHistory('123', { 'Content-Type': 'text/plain' }).body).toMatchObject({ type: 'text', raw: '123' });
  });

  it('TEMP-003 restores url-encoded bodies, including a single field and = in values', () => {
    const body = fromHistory('q=a%20b&token=x%3D%3D&plus=c+d&single', { 'Content-Type': 'application/x-www-form-urlencoded' }).body;
    expect(body.type).toBe('x-www-form-urlencoded');
    expect(body.urlencoded).toEqual([
      { key: 'q', value: 'a b', enabled: true },
      { key: 'token', value: 'x==', enabled: true },
      { key: 'plus', value: 'c d', enabled: true },
      { key: 'single', value: '', enabled: true },
    ]);
    expect(fromHistory('a=1', { 'Content-Type': 'application/x-www-form-urlencoded' }).body.urlencoded)
      .toEqual([{ key: 'a', value: '1', enabled: true }]);
    // 编码不完整时保留原文
    expect(fromHistory('a=%E0', { 'Content-Type': 'application/x-www-form-urlencoded' }).body.urlencoded)
      .toEqual([{ key: 'a', value: '%E0', enabled: true }]);
  });

  it('TEMP-004 guesses the body type from the content for records without Content-Type', () => {
    expect(fromHistory('{"a":1}').body.type).toBe('json');
    expect(fromHistory('a=1').body.type).toBe('x-www-form-urlencoded');
    expect(fromHistory('<root/>').body).toMatchObject({ type: 'xml', raw: '<root/>' });
    expect(fromHistory('plain words = not a form').body).toMatchObject({ type: 'text', raw: 'plain words = not a form' });
  });
});
