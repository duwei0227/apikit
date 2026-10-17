import { describe, expect, it } from 'vitest';
import { cloneJson } from '@/utils/clone';
import { createEmptyRequest, DEFAULT_REQUEST_SETTINGS } from '@/utils/requestFactory';
import { createTemporaryRequest } from '@/utils/temporaryRequest';
import { createWorkflowRequestStep } from '@/services/workflow/definition';

describe('request factory', () => {
  it('FACTORY-001 creates editor requests with one empty row per table', () => {
    const request = createEmptyRequest({ name: 'New' });
    expect(request).toMatchObject({ name: 'New', method: 'GET', url: '', auth: { type: 'none' } });
    expect(request.params).toEqual([{ key: '', value: '', enabled: true }]);
    expect(request.body.formData).toEqual([{ key: '', value: '', type: 'text', enabled: true }]);
    expect(request.tests.statusCodeTests[0]).toMatchObject({ enabled: true, expectedValue: '200' });
    expect(request.testsConfig).toEqual(request.tests);
    expect(request.testsConfig).not.toBe(request.tests);
    expect(request.settings).toBeUndefined();
  });

  it('FACTORY-002 creates stored requests without empty rows', () => {
    const request = createEmptyRequest({}, { withEmptyRows: false });
    expect(request.params).toEqual([]);
    expect(request.body).toEqual({ type: 'none', raw: '', formData: [], urlencoded: [] });
  });

  it('FACTORY-003 keeps each caller\'s specifics', () => {
    expect(createTemporaryRequest({ url: 'https://x', collectionId: 'c' })).toMatchObject({ url: 'https://x', collectionId: null, folderId: null });
    const step = createWorkflowRequestStep(undefined, 'Inline');
    expect(step.inlineRequest).toMatchObject({ name: 'Inline', settings: DEFAULT_REQUEST_SETTINGS });
    expect(step.inlineRequest!.settings).not.toBe(DEFAULT_REQUEST_SETTINGS);
    const a = createEmptyRequest();
    expect(createEmptyRequest().id).not.toBe(a.id);
  });

  it('FACTORY-004 deep copies plain data', () => {
    const source = { a: { b: [1, 2] } };
    const copy = cloneJson(source);
    expect(copy).toEqual(source);
    expect(copy.a).not.toBe(source.a);
  });
});
