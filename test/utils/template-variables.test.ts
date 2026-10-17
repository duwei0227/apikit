import { describe, expect, it } from 'vitest';
import {
  buildVariableCompletions,
  completionCursorOffset,
  completionInsertText,
  findOpenTemplate,
  findParameterHint,
  findTemplateVariableAt,
  getBaseVarName,
  PARAMETER_HINTS,
} from '@/utils/templateVariables';

describe('template variable helpers', () => {
  it('TPLVAR-001 detects the function whose parameters are being typed', () => {
    const text = '{"id": "{{$sequence(start=1';
    expect(findParameterHint(text, text.length)).toBe('$sequence');
    expect(findParameterHint('{{$randomInt( 1, 2', 18)).toBe('$randomInt');
    // 已闭合、没有括号、未知函数都不提示
    expect(findParameterHint('{{$sequence(1)}} x', 18)).toBeNull();
    expect(findParameterHint('{{$sequence', 11)).toBeNull();
    expect(findParameterHint('{{$unknown(', 11)).toBeNull();
    expect(PARAMETER_HINTS.$sequence.params.map(param => param.name)).toContain('step');
  });

  it('TPLVAR-002 finds an unclosed {{ before the cursor on the same line', () => {
    expect(findOpenTemplate('"a": "{{to')).toEqual({ openIndex: 6, prefix: 'to' });
    expect(findOpenTemplate('"a": "{{')).toEqual({ openIndex: 6, prefix: '' });
    expect(findOpenTemplate('"a": "{{token}}", "b": ')).toBeNull();
    expect(findOpenTemplate('"a": 1')).toBeNull();
  });

  it('TPLVAR-003 lists matching variables with built-in variables first', () => {
    const vars = { token: 'abc', baseUrl: 'https://x', $timestamp: '1', $guid: 'g' };
    const all = buildVariableCompletions(vars, '');
    expect(all.map(item => item.name)).toEqual(['$timestamp', '$guid', 'token', 'baseUrl']);
    expect(all[0].detail).toBe('Current timestamp in milliseconds');
    expect(all[2]).toEqual({ name: 'token', detail: '= abc', isBuiltIn: false });
    expect(buildVariableCompletions(vars, 'URL').map(item => item.name)).toEqual(['baseUrl']);
  });

  it('TPLVAR-004 does not repeat closing braces that are already there', () => {
    expect(completionInsertText('token', '}}",')).toBe('{{token');
    expect(completionInsertText('token', '",')).toBe('{{token}}');
  });

  it('TPLVAR-011 places the cursor after a trailing dot, otherwise after the closing braces', () => {
    // {{$request.headers.|}} 接着输入名称；{{token}}| 之后继续输入
    expect(completionCursorOffset('$request.headers.')).toBe('{{$request.headers.'.length);
    expect(completionCursorOffset('token')).toBe('{{token}}'.length);
    expect(completionCursorOffset('$request.body')).toBe('{{$request.body}}'.length);
    // 已完整输入 $request.headers. 时不再列出，免得插入后列表又弹出
    const variables = { '$request.headers.': 'header', '$request.body.': 'path', '$request.body': 'body' };
    expect(buildVariableCompletions(variables, '$request.headers.')).toEqual([]);
    expect(buildVariableCompletions(variables, '$request.body').map(item => item.name)).toEqual(['$request.body.', '$request.body']);
  });

  it('TPLVAR-005 finds the variable under a column, including both ends', () => {
    const line = '"a": "{{token}}", "b": "{{$sequence(start=5)}}"';
    expect(findTemplateVariableAt(line, 6)).toEqual({ base: 'token', index: 6, length: 9 });
    expect(findTemplateVariableAt(line, 15)?.base).toBe('token');
    expect(findTemplateVariableAt(line, 30)?.base).toBe('$sequence');
    expect(findTemplateVariableAt(line, 2)).toBeNull();
    expect(getBaseVarName(' $date("yyyy") ')).toBe('$date');
  });
});
