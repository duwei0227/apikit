import { describe, expect, it } from 'vitest';
import { neutralPlaceholder, validateRawBody, type PlaceholderResolver } from '@/utils/bodyValidation';

const values: Record<string, string> = { '{{id}}': '42', '{{name}}': 'Tom', '{{bad}}': 'abc', '{{quote}}': 'a"b' };
const resolve: PlaceholderResolver = placeholder => values[placeholder] ?? placeholder;

describe('validateRawBody (json)', () => {
  it('accepts valid JSON, empty bodies and comments', () => {
    expect(validateRawBody('json', '{"a": [1, 2]}', resolve)).toBeNull();
    expect(validateRawBody('json', '  \n', resolve)).toBeNull();
    expect(validateRawBody('json', '// only a comment', resolve)).toBeNull();
    expect(validateRawBody('json', '{\n  "a": 1, // note\n  // "b": 2\n}', resolve)).toBeNull();
  });

  it('validates the body after replacing variables', () => {
    expect(validateRawBody('json', '{"id": {{id}}, "name": "{{name}}"}', resolve)).toBeNull();
  });

  it('reports the editor position of a syntax error', () => {
    expect(validateRawBody('json', '{\n  "a": 1\n  "b": 2\n}', resolve))
      .toEqual({ message: 'Comma expected', line: 3, column: 3 });
    expect(validateRawBody('json', '[1,]', resolve)).toEqual({ message: 'Value expected', line: 1, column: 4 });
  });

  it('maps positions after a variable back to the editor text', () => {
    expect(validateRawBody('json', '{"name": "{{name}}" "x": 1}', resolve))
      .toEqual({ message: 'Comma expected', line: 1, column: 21 });
  });

  it('points at the variable whose value breaks the JSON', () => {
    expect(validateRawBody('json', '{"id": {{bad}}}', resolve))
      .toEqual({ message: 'Invalid symbol', line: 1, column: 8, placeholder: '{{bad}}' });
    expect(validateRawBody('json', '{"id": {{missing}}}', resolve)?.placeholder).toBe('{{missing}}');
    expect(validateRawBody('json', '{"q": "{{quote}}"}', resolve)?.placeholder).toBe('{{quote}}');
  });

  it('keeps trailing commas an error when there are no comments', () => {
    expect(validateRawBody('json', '{"a": 1,}', resolve)?.message).toBe('Property name expected');
  });

  it('accepts unquoted placeholders with the neutral resolver', () => {
    expect(validateRawBody('json', '{"id": {{id}}, {{key}}: "{{v}}"}', neutralPlaceholder)).toBeNull();
  });
});

describe('validateRawBody (xml)', () => {
  it('accepts valid XML with variables', () => {
    expect(validateRawBody('xml', '<a id="{{id}}">{{name}}</a>', resolve)).toBeNull();
  });

  it('reports unclosed tags and bare ampersands', () => {
    expect(validateRawBody('xml', '<a>\n  <b>\n</a>', resolve)?.line).toBe(3);
    expect(validateRawBody('xml', '<a>{{name}} & co</a>', resolve))
      .toEqual({ message: "Bare '&' must be escaped as &amp;", line: 1, column: 13 });
  });
});
