import { describe, expect, it } from 'vitest';
import { buildMockRequestData } from '@/utils/mockMatching';
import { MAX_MOCK_REPEAT, renderMockTemplate, type MockTemplateContext } from '@/utils/mockTemplate';

const context = (query = '', body = '', extra: Partial<MockTemplateContext> = {}): MockTemplateContext => {
  const request = buildMockRequestData({
    method: 'POST',
    path: '/orders/42',
    query,
    headers: [['X-Trace', 't-1'], ['Cookie', 'sid=s9']],
    body,
  });
  request.params = { id: '42' };
  let counter = 0;
  return {
    request,
    resolveVariable: name => (name === 'baseUrl' ? 'https://api.example.com' : name === '$guid' ? `g${++counter}` : undefined),
    ...extra,
  };
};

describe('mock templates', () => {
  it('reads request data with defaults', () => {
    const text = renderMockTemplate(
      '{"id": {{$request.params.id}}, "page": {{$request.query.page ?? 1}}, "trace": "{{$request.headers.x-trace}}", '
        + '"sid": "{{$request.cookies.sid}}", "sku": "{{$request.body.items[0].sku}}", "m": "{{$request.method}} {{$request.path}}", '
        + '"none": "{{$request.query.none}}", "label": "{{$request.query.label ?? \'n/a\'}}"}',
      context('', '{"items":[{"sku":"A1"}]}'),
    );
    expect(JSON.parse(text)).toEqual({
      id: 42, page: 1, trace: 't-1', sid: 's9', sku: 'A1', m: 'POST /orders/42', none: '', label: 'n/a',
    });
  });

  it('writes objects as JSON and resolves other variables', () => {
    expect(renderMockTemplate('{{$request.body.user}}', context('', '{"user":{"a":1}}'))).toBe('{"a":1}');
    expect(renderMockTemplate('{{baseUrl}}/x {{unknown}} {{unknown ?? d}}', context())).toBe('https://api.example.com/x {{unknown}} d');
  });

  it('repeats blocks with an index and joins the copies with commas', () => {
    const template = '[\n  {{#repeat $request.query.size ?? 2}}\n  { "n": {{$index}}, "id": "{{$guid}}" }\n  {{/repeat}}\n]';
    const two = renderMockTemplate(template, context());
    expect(JSON.parse(two)).toEqual([{ n: 1, id: 'g1' }, { n: 2, id: 'g2' }]);
    expect(JSON.parse(renderMockTemplate(template, context('size=4')))).toHaveLength(4);
    expect(JSON.parse(renderMockTemplate(template, context('size=0')))).toEqual([]);
    expect(JSON.parse(renderMockTemplate(template, context('size=abc')))).toEqual([]);
    expect(JSON.parse(renderMockTemplate('[{{#repeat 99999}}1{{/repeat}}]', context()))).toHaveLength(MAX_MOCK_REPEAT);
  });

  it('supports nested blocks and $pick', () => {
    const text = renderMockTemplate('[{{#repeat 2}}[{{#repeat 3}}{{$index}}{{/repeat}}]{{/repeat}}]', context());
    expect(JSON.parse(text)).toEqual([[1, 2, 3], [1, 2, 3]]);
    const picked = renderMockTemplate("{{$pick('paid', 'pending')}}", context());
    expect(['paid', 'pending']).toContain(picked);
  });

  it('keeps unclosed blocks and text without tags as written', () => {
    expect(renderMockTemplate('{{#repeat 2}}x', context())).toBe('{{#repeat 2}}x');
    expect(renderMockTemplate('{{/repeat}}', context())).toBe('{{/repeat}}');
    expect(renderMockTemplate('plain', context())).toBe('plain');
    expect(renderMockTemplate('', context())).toBe('');
  });
});
