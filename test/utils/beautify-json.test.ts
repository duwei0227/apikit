import { describe, expect, it } from 'vitest';
import { beautifyJsonText, repairJsonText } from '@/utils/beautifyJson';

describe('repairJsonText', () => {
  it.each([
    ['inserts a comma between members', '{"a": {} "b":"xx"}', '{"a": {}, "b":"xx"}'],
    ['inserts a comma after a scalar value', '{"a":1 "b":2}', '{"a":1, "b":2}'],
    ['inserts a comma between array items', '[1 2 {"a":1} [3]]', '[1, 2, {"a":1}, [3]]'],
    ['drops duplicate commas', '[1,,2]', '[1,2]'],
    ['drops duplicate commas in objects', '{"a":1,,"b":2}', '{"a":1,"b":2}'],
    ['drops a leading comma', '[,1]', '[1]'],
    ['drops trailing commas', '{"a":[1,],}', '{"a":[1]}'],
    ['converts single quotes', "{'a': 'it\\'s \"x\"'}", '{"a": "it\'s \\"x\\""}'],
    ['quotes bare keys', '{a: 1, b_c: true}', '{"a": 1, "b_c": true}'],
    ['fills a missing value before }', '{"a":}', '{"a":null}'],
    ['fills a missing value before ,', '{"a":,"b":1}', '{"a":null,"b":1}'],
    ['fills a key without value', '{"a"}', '{"a": null}'],
    ['fills a key without value before the next key', '{"a" "b": 1}', '{"a": null, "b": 1}'],
    ['inserts a missing colon', '{"a" 1}', '{"a": 1}'],
    ['fills a truncated value', '{"a":', '{"a":null}'],
    ['fills a truncated key', '{"a', '{"a": null}'],
    ['closes truncated structures', '{"a":[1,2', '{"a":[1,2]}'],
    ['drops a dangling comma when closing', '{"a":1,', '{"a":1}'],
    ['escapes control characters in strings', '{"a":"x\ny"}', '{"a":"x\\ny"}'],
  ])('%s', (_name, input, expected) => {
    expect(repairJsonText(input)).toBe(expected);
  });

  it('keeps comments and a comma before a commented-out last item', () => {
    const input = '{\n  "a": 1, // first\n  // "b": 2\n}';
    expect(repairJsonText(input)).toBe(input);
  });

  it('leaves valid JSON untouched', () => {
    const input = '{"a":[1,{"b":null}],"c":"x, y: z","d":12345678901234567890}';
    expect(repairJsonText(input)).toBe(input);
  });
});

describe('beautifyJsonText', () => {
  it('repairs and formats in one go', () => {
    expect(beautifyJsonText("{a: 'x' b: {} 'c':}")).toBe([
      '{',
      '  "a": "x",',
      '  "b": {},',
      '  "c": null',
      '}',
    ].join('\n'));
  });

  it('keeps template variables quoted and unquoted', () => {
    expect(beautifyJsonText('{"id":{{id}} "name":"{{name}}", key: \'{{x}}\'}')).toBe([
      '{',
      '  "id": {{id}},',
      '  "name": "{{name}}",',
      '  "key": "{{x}}"',
      '}',
    ].join('\n'));
  });

  it('still rejects plain text', () => {
    expect(() => beautifyJsonText('hello world')).toThrow(/No valid JSON/);
  });
});
