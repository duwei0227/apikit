import { describe, expect, it, vi } from 'vitest';
import {
  areTestsPassed,
  cancelHttpExecution,
  executeHttpRequest,
  executeRequestTests,
  extractValueFromJsonPath,
} from '@/services/http/HttpExecutionService';
import { httpbinInvocations, httpbinUrl } from '../helpers/httpbin';
import { emptyTests, makeRequest, passingStatusTest } from '../helpers/workflowFactory';

describe('HttpRequest execution service', () => {
  it('HTTP-REQ-001 executes GET with params, headers, variable replacement, and console log', async () => {
    const consoleLogs: any[] = [];
    const started = vi.fn();
    const request = makeRequest({
      method: 'GET',
      url: httpbinUrl('/anything'),
      params: [
        { key: 'q', value: '{{QUERY}}', enabled: true },
        { key: 'disabled', value: 'skip', enabled: false },
      ],
      headers: [
        { key: 'x-apikit-test', value: '{{HEADER}}', enabled: true },
        { key: 'x-disabled', value: 'skip', enabled: false },
      ],
      tests: passingStatusTest('200'),
    });

    const result = await executeHttpRequest(request, {
      replaceVariables: value => value.replace('{{QUERY}}', 'hello world').replace('{{HEADER}}', 'header-value'),
      onConsoleLog: log => consoleLogs.push(log),
      onRequestStart: started,
    });

    const body = JSON.parse(result.response.rawBody);
    expect(result.response.status).toBe(200);
    expect(body.args.q).toBe('hello world');
    expect(body.args.disabled).toBeUndefined();
    expect(body.headers['X-Apikit-Test']).toBe('header-value');
    expect(started).toHaveBeenCalledOnce();
    expect(consoleLogs).toHaveLength(1);
    expect(areTestsPassed(result.testResults)).toBe(true);
  });

  it('HTTP-REQ-002 sends JSON, urlencoded, and text form-data request bodies', async () => {
    const jsonResult = await executeHttpRequest(makeRequest({
      method: 'POST',
      url: httpbinUrl('/anything'),
      body: {
        type: 'json',
        raw: '{"name":"apikit"}',
        formData: [],
        urlencoded: [],
      },
      tests: emptyTests(),
    }));
    expect(JSON.parse(jsonResult.response.rawBody).json).toEqual({ name: 'apikit' });
    expect(httpbinInvocations.at(-1)?.headers['Content-Type']).toBe('application/json');
    expect(jsonResult.consoleLog.requestHeaders['Content-Type']).toBe('application/json');

    const urlencodedResult = await executeHttpRequest(makeRequest({
      method: 'POST',
      url: httpbinUrl('/anything'),
      body: {
        type: 'x-www-form-urlencoded',
        raw: '',
        formData: [],
        urlencoded: [{ key: 'mode', value: 'urlencoded', enabled: true }],
      },
      tests: emptyTests(),
    }));
    expect(JSON.parse(urlencodedResult.response.rawBody).form.mode).toBe('urlencoded');
    expect(httpbinInvocations.at(-1)?.headers['Content-Type']).toBe('application/x-www-form-urlencoded');

    const formDataResult = await executeHttpRequest(makeRequest({
      method: 'POST',
      url: httpbinUrl('/anything'),
      body: {
        type: 'form-data',
        raw: '',
        formData: [{ key: 'mode', value: 'form-data', type: 'text', enabled: true }],
        urlencoded: [],
      },
      tests: emptyTests(),
    }));
    expect(JSON.parse(formDataResult.response.rawBody).json).toEqual({ mode: 'form-data' });
    expect(httpbinInvocations.at(-1)?.headers['Content-Type']).toBe('application/json');
  });

  it('sends plain text and binary file request bodies without JSON conversion', async () => {
    const textResult = await executeHttpRequest(makeRequest({
      method: 'POST',
      url: httpbinUrl('/anything'),
      headers: [{ key: 'Content-Type', value: 'text/plain', enabled: true }],
      body: {
        type: 'text',
        raw: 'hello {{NAME}}',
        formData: [],
        urlencoded: [],
      },
      tests: emptyTests(),
    }), {
      replaceVariables: value => value.replace('{{NAME}}', 'ApiKit'),
    });

    expect(JSON.parse(textResult.response.rawBody).data).toBe('hello ApiKit');
    expect(httpbinInvocations.at(-1)?.headers['Content-Type']).toBe('text/plain');

    await executeHttpRequest(makeRequest({
      method: 'POST',
      url: httpbinUrl('/anything'),
      body: {
        type: 'binary',
        raw: '',
        filePath: '/tmp/{{FILE}}',
        formData: [],
        urlencoded: [],
      },
      tests: emptyTests(),
    }), {
      replaceVariables: value => value.replace('{{FILE}}', 'payload.bin'),
    });

    expect(httpbinInvocations.at(-1)?.bodyFilePath).toBe('/tmp/payload.bin');
    expect(httpbinInvocations.at(-1)?.body).toBeUndefined();
  });

  it('does not send binary files for methods that reject request bodies', async () => {
    await executeHttpRequest(makeRequest({
      method: 'HEAD',
      url: httpbinUrl('/anything'),
      body: {
        type: 'binary',
        raw: '',
        filePath: '/tmp/payload.bin',
        formData: [],
        urlencoded: [],
      },
      tests: emptyTests(),
    }));

    expect(httpbinInvocations.at(-1)?.bodyFilePath).toBeUndefined();
  });

  it('HTTP-REQ-003 applies bearer and basic auth headers', async () => {
    const bearer = await executeHttpRequest(makeRequest({
      url: httpbinUrl('/bearer'),
      auth: {
        type: 'bearer',
        token: 'test-token',
        username: '',
        password: '',
      },
      tests: emptyTests(),
    }));
    expect(JSON.parse(bearer.response.rawBody).authenticated).toBe(true);
    expect(httpbinInvocations.at(-1)?.headers.Authorization).toBe('Bearer test-token');

    const basic = await executeHttpRequest(makeRequest({
      url: httpbinUrl('/basic-auth/user/pass'),
      auth: {
        type: 'basic',
        token: '',
        username: 'user',
        password: 'pass',
      },
      tests: emptyTests(),
    }));
    expect(JSON.parse(basic.response.rawBody).authenticated).toBe(true);
    expect(httpbinInvocations.at(-1)?.headers.Authorization).toMatch(/^Basic /);
  });

  it('HTTP-REQ-004 passes request settings to Tauri invoke options', async () => {
    await executeHttpRequest(makeRequest({
      url: httpbinUrl('/status/200'),
      settings: {
        followRedirects: false,
        maxRedirectCount: 3,
        verifySsl: false,
        autoEncodeUrl: true,
        acceptEncoding: false,
      },
      tests: emptyTests(),
    }));

    const options = httpbinInvocations.at(-1);
    expect(options.maxRedirections).toBe(0);
    expect(options.verifySsl).toBe(false);
    expect(options.acceptEncoding).toBe(false);
    expect(options.headers['Accept-Encoding']).toBeUndefined();
  });

  it('HTTP-REQ-005 evaluates status, json field, and global variable test configs', async () => {
    const globals: Record<string, string> = {};
    const result = await executeHttpRequest(makeRequest({
      url: httpbinUrl('/anything'),
      params: [{ key: 'token', value: 'abc123', enabled: true }],
      tests: {
        statusCodeTests: [{ enabled: true, operator: 'equals', expectedValue: '200', description: '' }],
        jsonFieldTests: [{ enabled: true, jsonPath: '$.args.token', operator: 'equals', expectedValue: 'abc123', description: '' }],
        globalVariables: [{ enabled: true, variableName: 'tokenVar', valueType: 'jsonPath', jsonPath: '$.args.token', customValue: '', description: '' }],
      },
    }), {
      setGlobalVariable: (key, value) => {
        globals[key] = value;
      },
    });

    expect(areTestsPassed(result.testResults)).toBe(true);
    expect(globals.tokenVar).toBe('abc123');
    expect(result.testResults.globalVars[0]).toMatchObject({
      success: true,
      status: 'set',
      variableName: 'tokenVar',
      valueType: 'jsonPath',
      source: '$.args.token',
      value: 'abc123',
    });
  });

  it('records failed and skipped global variable settings', () => {
    const unresolved = executeRequestTests(
      { status: 200, rawBody: '{"value":"ok"}' },
      {
        statusCodeTests: [],
        jsonFieldTests: [],
        globalVariables: [{ enabled: true, variableName: 'missingVar', valueType: 'jsonPath', jsonPath: '$.missing', customValue: '', description: '' }],
      },
      { setGlobalVariable: () => {} },
    );
    expect(unresolved.globalVars[0]).toMatchObject({
      success: false,
      status: 'failed',
      variableName: 'missingVar',
      source: '$.missing',
      message: 'Failed to set missingVar: value could not be resolved',
    });

    const skipped = executeRequestTests(
      { status: 500, rawBody: '{}' },
      {
        statusCodeTests: [{ enabled: true, operator: 'equals', expectedValue: '200', description: '' }],
        jsonFieldTests: [],
        globalVariables: [{ enabled: true, variableName: 'tokenVar', valueType: 'customValue', jsonPath: '', customValue: 'token', description: '' }],
      },
      { setGlobalVariable: () => {} },
    );
    expect(skipped.globalVars[0]).toMatchObject({
      success: false,
      status: 'skipped',
      variableName: 'tokenVar',
      source: 'Custom value',
      message: 'Skipped tokenVar: request tests failed',
    });
  });

  it.each([
    ['equals', 'hello', true],
    ['notEquals', '4', true],
    ['contains', 'ell', true],
    ['notContains', 'xyz', true],
    ['exists', '', true],
    ['notExists', '', true],
    ['greaterThan', '3', true],
    ['lessThan', '7', true],
    ['greaterThanOrEquals', '5', true],
    ['lessThanOrEquals', '5', true],
  ])('HTTP-REQ-006 evaluates request test operator %s', (operator, expectedValue, passed) => {
    const results = executeRequestTests(
      { status: 5, rawBody: '{"value":"hello","missing":null}' },
      {
        statusCodeTests: [],
        jsonFieldTests: [{
          enabled: true,
          jsonPath: operator === 'notExists' ? '$.absent' : operator.includes('Than') ? '$.statusValue' : '$.value',
          operator,
          expectedValue,
          description: '',
        }],
        globalVariables: [],
      },
    );

    if (operator.includes('Than')) {
      const numericResults = executeRequestTests(
        { status: 5, rawBody: '{"statusValue":5}' },
        {
          statusCodeTests: [],
          jsonFieldTests: [{ enabled: true, jsonPath: '$.statusValue', operator, expectedValue, description: '' }],
          globalVariables: [],
        },
      );
      expect(numericResults.jsonFields[0].passed).toBe(passed);
      return;
    }

    expect(results.jsonFields[0].passed).toBe(passed);
  });

  it('HTTP-REQ-007 extracts JSON path values and reports failed tests', () => {
    expect(extractValueFromJsonPath({ a: { b: [{ c: 3 }] } }, '$.a.b[0].c')).toBe(3);

    const results = executeRequestTests(
      { status: 500, rawBody: '{"ok":false}' },
      {
        statusCodeTests: [{ enabled: true, operator: 'equals', expectedValue: '200', description: '' }],
        jsonFieldTests: [{ enabled: true, jsonPath: '$.ok', operator: 'equals', expectedValue: 'true', description: '' }],
        globalVariables: [],
      },
    );
    expect(areTestsPassed(results)).toBe(false);
  });

  it('normalizes legacy status test values without mutating the config', () => {
    const legacyConfig = {
      statusCodeTests: [{ enabled: true, operator: 'equals', value: '200' }],
      jsonFieldTests: [],
      globalVariables: [],
    };

    const results = executeRequestTests({ status: 200, rawBody: '{}' }, legacyConfig);

    expect(areTestsPassed(results)).toBe(true);
    expect(results.statusCode[0]).toMatchObject({
      actualValue: 200,
      operator: 'equals',
      expectedValue: '200',
    });
    expect(legacyConfig.statusCodeTests[0]).not.toHaveProperty('expectedValue');
  });

  it('reports invalid status expectations instead of comparing against NaN', () => {
    const results = executeRequestTests(
      { status: 200, rawBody: '{}' },
      {
        statusCodeTests: [{ enabled: true, operator: 'equals', expectedValue: '', description: '' }],
        jsonFieldTests: [],
        globalVariables: [],
      },
    );

    expect(results.statusCode[0]).toMatchObject({
      passed: false,
      message: 'Expected status code is missing or invalid',
    });
  });

  it('fails configured JSON assertions when the response is not valid JSON', () => {
    const results = executeRequestTests(
      { status: 200, rawBody: '<html>not json</html>' },
      {
        statusCodeTests: [],
        jsonFieldTests: [{ enabled: true, jsonPath: '$.ok', operator: 'equals', expectedValue: 'true', description: '' }],
        globalVariables: [],
      },
    );

    expect(results.jsonFields[0]).toMatchObject({
      passed: false,
      message: '$.ok: response is not valid JSON',
    });
  });

  it('HTTP-REQ-008 cancels an in-flight request by runtime id', async () => {
    await expect(cancelHttpExecution('req-test')).resolves.toBe(true);
    await expect(cancelHttpExecution(null)).resolves.toBe(false);
  });

  it('HTTP-REQ-009 sends GET request bodies for every supported body type', async () => {
    const jsonResult = await executeHttpRequest(makeRequest({
      method: 'GET',
      url: httpbinUrl('/anything'),
      body: {
        type: 'json',
        raw: '{"name":"{{NAME}}"}',
        formData: [],
        urlencoded: [],
      },
      tests: emptyTests(),
    }), {
      replaceVariables: value => value.replace('{{NAME}}', 'apikit'),
    });
    expect(JSON.parse(jsonResult.response.rawBody).json).toEqual({ name: 'apikit' });
    expect(httpbinInvocations.at(-1)?.method).toBe('GET');
    expect(httpbinInvocations.at(-1)?.headers['Content-Type']).toBe('application/json');

    const urlencodedResult = await executeHttpRequest(makeRequest({
      method: 'GET',
      url: httpbinUrl('/anything'),
      body: {
        type: 'x-www-form-urlencoded',
        raw: '',
        formData: [],
        urlencoded: [{ key: 'mode', value: 'urlencoded', enabled: true }],
      },
      tests: emptyTests(),
    }));
    expect(JSON.parse(urlencodedResult.response.rawBody).form.mode).toBe('urlencoded');
    expect(httpbinInvocations.at(-1)?.headers['Content-Type']).toBe('application/x-www-form-urlencoded');

    const formDataResult = await executeHttpRequest(makeRequest({
      method: 'GET',
      url: httpbinUrl('/anything'),
      body: {
        type: 'form-data',
        raw: '',
        formData: [{ key: 'mode', value: 'form-data', type: 'text', enabled: true }],
        urlencoded: [],
      },
      tests: emptyTests(),
    }));
    expect(JSON.parse(formDataResult.response.rawBody).json).toEqual({ mode: 'form-data' });
    expect(httpbinInvocations.at(-1)?.headers['Content-Type']).toBe('application/json');
  });

  it.each(['HEAD', 'OPTIONS'] as const)('HTTP-REQ-010 does not send a request body for %s', async method => {
    await executeHttpRequest(makeRequest({
      method,
      url: httpbinUrl('/anything'),
      body: {
        type: 'json',
        raw: '{"ignored":true}',
        formData: [],
        urlencoded: [],
      },
      tests: emptyTests(),
    }));

    expect(httpbinInvocations.at(-1)?.body).toBeUndefined();
    expect(httpbinInvocations.at(-1)?.headers['Content-Type']).toBeUndefined();
  });

  it.each(['POST', 'GET'] as const)('HTTP-REQ-011 sends an XML body with %s', async method => {
    const result = await executeHttpRequest(makeRequest({
      method,
      url: httpbinUrl('/anything'),
      body: {
        type: 'xml',
        raw: '<request><name>{{NAME}}</name></request>',
        formData: [],
        urlencoded: [],
      },
      tests: emptyTests(),
    }), {
      replaceVariables: value => value.replace('{{NAME}}', 'apikit'),
    });

    expect(JSON.parse(result.response.rawBody).data).toBe('<request><name>apikit</name></request>');
    expect(httpbinInvocations.at(-1)?.headers['Content-Type']).toBe('application/xml');
    expect(result.consoleLog.requestHeaders['Content-Type']).toBe('application/xml');
  });

  it('HTTP-REQ-012 preserves an explicit XML-compatible content type', async () => {
    await executeHttpRequest(makeRequest({
      method: 'POST',
      url: httpbinUrl('/anything'),
      headers: [{ key: 'content-type', value: 'application/soap+xml; charset=utf-8', enabled: true }],
      body: {
        type: 'xml',
        raw: '<soap:Envelope xmlns:soap="urn:soap"/>',
        formData: [],
        urlencoded: [],
      },
      tests: emptyTests(),
    }));

    const headers = httpbinInvocations.at(-1)?.headers;
    expect(headers['content-type']).toBe('application/soap+xml; charset=utf-8');
    expect(headers['Content-Type']).toBeUndefined();
  });

  it.each([
    {
      type: 'json' as const,
      raw: '{"name":"apikit"}',
      urlencoded: [],
      contentType: 'application/vnd.api+json',
    },
    {
      type: 'x-www-form-urlencoded' as const,
      raw: '',
      urlencoded: [{ key: 'name', value: 'apikit', enabled: true }],
      contentType: 'text/plain',
    },
  ])('HTTP-REQ-013 preserves an explicit Content-Type for $type bodies', async ({
    type,
    raw,
    urlencoded,
    contentType,
  }) => {
    await executeHttpRequest(makeRequest({
      method: 'POST',
      url: httpbinUrl('/anything'),
      headers: [{ key: 'content-type', value: contentType, enabled: true }],
      body: {
        type,
        raw,
        formData: [],
        urlencoded,
      },
      tests: emptyTests(),
    }));

    const headers = httpbinInvocations.at(-1)?.headers;
    expect(headers['content-type']).toBe(contentType);
    expect(headers['Content-Type']).toBeUndefined();
  });

  it.each([
    ['json', 'application/json'],
    ['xml', 'application/xml'],
  ] as const)('HTTP-REQ-014 records the implicit Content-Type for an empty %s body', async (
    type,
    contentType,
  ) => {
    const result = await executeHttpRequest(makeRequest({
      method: 'GET',
      url: httpbinUrl('/anything'),
      body: {
        type,
        raw: '',
        formData: [],
        urlencoded: [],
      },
      tests: emptyTests(),
    }));

    expect(httpbinInvocations.at(-1)?.headers['Content-Type']).toBe(contentType);
    expect(result.consoleLog.requestHeaders['Content-Type']).toBe(contentType);
  });

  it('HTTP-REQ-015 records the generated multipart Content-Type for a file upload', async () => {
    const result = await executeHttpRequest(makeRequest({
      method: 'POST',
      url: httpbinUrl('/anything'),
      body: {
        type: 'form-data',
        raw: '',
        formData: [{
          key: 'upload',
          value: 'sample.txt',
          type: 'file',
          enabled: true,
          filePath: '/tmp/sample.txt',
        }],
        urlencoded: [],
      },
      tests: emptyTests(),
    }));

    expect(result.consoleLog.requestHeaders['Content-Type'])
      .toBe('multipart/form-data; boundary=mock-boundary');
  });
});
