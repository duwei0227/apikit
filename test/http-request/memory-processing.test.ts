import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeRequestTests } from '@/services/http/HttpExecutionService';

afterEach(() => vi.restoreAllMocks());

const field = { enabled: true, jsonPath: '$.id', operator: 'equals', expectedValue: '852633836497678336' };
const variable = { enabled: true, variableName: 'result', valueType: 'jsonPath', jsonPath: '$.obj' };

describe('request tests body access', () => {
  it.each([
    {},
    { statusCodeTests: [{ enabled: true, expectedValue: '200', operator: 'equals' }] },
    { jsonFieldTests: [{ ...field, enabled: false }] },
    { jsonFieldTests: [{ ...field, jsonPath: '' }] },
    { globalVariables: [{ ...variable, enabled: false }] },
    { globalVariables: [{ ...variable, variableName: '' }] },
    { globalVariables: [{ ...variable, valueType: 'header', headerName: 'x-id' }] },
    { globalVariables: [{ ...variable, valueType: 'customValue', customValue: 'hello' }] },
    { statusCodeTests: [{ enabled: true, expectedValue: '201', operator: 'equals' }], globalVariables: [variable] },
  ])('does not read the body unless a JSON consumer runs: %j', config => {
    const read = vi.fn(() => '{"obj":{"a":1}}');
    executeRequestTests({ status: 200, headers: { 'x-id': '42' }, get rawBody() { return read(); } }, config, { setGlobalVariable: vi.fn() });
    expect(read).not.toHaveBeenCalled();
  });

  it('reads and parses once for multiple assertions and extraction, preserving large integers', () => {
    const read = vi.fn(() => '{"id":852633836497678336,"obj":{"id":852633836497678336}}');
    const set = vi.fn();
    const result = executeRequestTests({ status: 200, get rawBody() { return read(); } }, {
      jsonFieldTests: [field, field], globalVariables: [variable],
    }, { setGlobalVariable: set });
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.jsonFields.every(test => test.passed)).toBe(true);
    expect(set).toHaveBeenCalledWith('result', '{"id":"852633836497678336"}', true, '');
    expect(result.globalVars[0].value).toBe('{"id":"852633836497678336"}');
  });

  it('retains invalid JSON errors and skips extraction when assertions fail', () => {
    const result = executeRequestTests({ status: 200, rawBody: '{' }, { jsonFieldTests: [field], globalVariables: [variable] });
    expect(result.jsonFields[0].passed).toBe(false);
    expect(result.globalVars[0].status).toBe('skipped');
  });
});


describe('variable serialization', () => {
  it('serializes an extracted object once and reuses it for the setter, message and value', () => {
    const stringify = vi.spyOn(JSON, 'stringify');
    const set = vi.fn();
    const result = executeRequestTests({ status: 200, rawBody: '{"obj":{"a":1}}' }, { globalVariables: [variable] }, { setGlobalVariable: set });
    expect(stringify).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith('result', '{"a":1}', true, '');
    expect(result.globalVars[0]).toMatchObject({ value: '{"a":1}', message: 'Set result = {"a":1}', status: 'set' });
  });
  it('uses stream testBody and preserves the result when the setter is unavailable', () => {
    const readRaw = vi.fn(() => 'invalid raw stream');
    const result = executeRequestTests({ status: 200, testBody: '{"obj":{"a":1}}', get rawBody() { return readRaw(); } }, { globalVariables: [variable] });
    expect(readRaw).not.toHaveBeenCalled();
    expect(result.globalVars[0]).toMatchObject({ value: '{"a":1}', status: 'failed' });
  });
});
