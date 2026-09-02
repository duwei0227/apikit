import { describe, expect, it } from 'vitest';
import {
  applyWorkflowRequestOverrides,
  buildWorkflowRequestOverrides,
  getWorkflowRequestOverrideSections,
  resetWorkflowRequestOverrideSection,
} from '@/utils/workflowRequestOverrides';
import {
  prepareRequestForEditing,
  prepareRequestForPersistence,
} from '@/utils/requestDraft';
import { emptyTests, makeRequest, passingStatusTest } from '../helpers/workflowFactory';

describe('workflow request overrides', () => {
  it('stores only execution settings that differ from the base request', () => {
    const base = makeRequest({
      id: 'base-request',
      name: 'Base Request',
      params: [{ key: 'inherited', value: 'yes', enabled: true }],
      tests: emptyTests(),
    });
    const edited = JSON.parse(JSON.stringify(base));
    edited.id = 'workflow-editor-id';
    edited.name = 'Ignored editor name';
    edited.url = 'https://httpbin.org/anything';
    edited.params = [{ key: 'custom', value: 'value', enabled: true }];
    edited.settings.verifySsl = false;

    const overrides = buildWorkflowRequestOverrides(base, edited);

    expect(overrides).toEqual({
      url: 'https://httpbin.org/anything',
      params: [{ key: 'custom', value: 'value', enabled: true }],
      settings: { verifySsl: false },
    });
  });

  it('dynamically inherits untouched sections while replacing customized sections', () => {
    const original = makeRequest({
      method: 'GET',
      headers: [{ key: 'x-version', value: 'one', enabled: true }],
      params: [{ key: 'source', value: 'base', enabled: true }],
      tests: emptyTests(),
    });
    const overrides = {
      method: 'POST' as const,
      params: [{ key: 'source', value: 'workflow', enabled: true }],
      testsConfig: passingStatusTest('201'),
      settings: { verifySsl: false },
    };
    const updatedBase = makeRequest({
      ...original,
      method: 'PATCH',
      headers: [{ key: 'x-version', value: 'two', enabled: true }],
      settings: { ...original.settings, followRedirects: false, verifySsl: true },
    });

    const effective = applyWorkflowRequestOverrides(updatedBase, overrides);

    expect(effective.method).toBe('POST');
    expect(effective.params).toEqual([{ key: 'source', value: 'workflow', enabled: true }]);
    expect(effective.headers).toEqual([{ key: 'x-version', value: 'two', enabled: true }]);
    expect(effective.settings).toMatchObject({ followRedirects: false, verifySsl: false });
    expect(effective.testsConfig).toEqual(passingStatusTest('201'));
    expect(effective.tests).toEqual(passingStatusTest('201'));
    expect(updatedBase.method).toBe('PATCH');
  });

  it('removes overrides when an edited section is restored to the base value', () => {
    const base = makeRequest({
      params: [{ key: 'source', value: 'base', enabled: true }],
    });
    const edited = applyWorkflowRequestOverrides(base, {
      params: [{ key: 'source', value: 'workflow', enabled: true }],
      settings: { verifySsl: false },
    });

    const restored = resetWorkflowRequestOverrideSection(edited, base, 'params');
    const overrides = buildWorkflowRequestOverrides(base, restored);

    expect(getWorkflowRequestOverrideSections(overrides)).toEqual(['settings']);
    expect(overrides?.params).toBeUndefined();
  });

  it('treats missing settings as their runtime defaults', () => {
    const base = makeRequest();
    delete base.settings;
    const edited = JSON.parse(JSON.stringify(base));
    edited.settings = {
      followRedirects: true,
      maxRedirectCount: 10,
      verifySsl: true,
      autoEncodeUrl: true,
      acceptEncoding: true,
    };

    expect(buildWorkflowRequestOverrides(base, edited)).toBeUndefined();
  });

  it('does not freeze the base URL when only query params are customized', () => {
    const base = makeRequest({
      url: 'https://httpbin.org/get?source=base',
      params: [{ key: 'source', value: 'base', enabled: true }],
    });
    const edited = JSON.parse(JSON.stringify(base));
    edited.url = 'https://httpbin.org/get?source=workflow';
    edited.params = [{ key: 'source', value: 'workflow', enabled: true }];

    const overrides = buildWorkflowRequestOverrides(base, edited);
    const updatedBase = makeRequest({
      ...base,
      url: 'https://api.example.com/users?source=base',
    });
    const effective = applyWorkflowRequestOverrides(updatedBase, overrides);

    expect(overrides?.url).toBeUndefined();
    expect(overrides?.params).toEqual([{ key: 'source', value: 'workflow', enabled: true }]);
    expect(effective.url).toBe('https://api.example.com/users?source=workflow');
  });

  it('does not create overrides from editor-only empty rows and default settings', () => {
    const base = makeRequest({
      params: [],
      headers: [],
      body: {
        type: 'none',
        raw: '',
        formData: [],
        urlencoded: [],
      },
    });
    delete base.settings;

    const editor = prepareRequestForEditing(applyWorkflowRequestOverrides(base));
    editor.settings = {
      followRedirects: true,
      maxRedirectCount: 10,
      verifySsl: true,
      autoEncodeUrl: true,
      acceptEncoding: true,
    };

    expect(
      buildWorkflowRequestOverrides(base, prepareRequestForPersistence(editor)),
    ).toBeUndefined();
  });
});
