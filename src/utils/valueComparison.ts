// 断言和 Workflow 条件共用的取值比较。对象和数组按 JSON 文本比较和显示，
// 例如提取到的 {"id":1} 不会变成 "[object Object]"。

/** 取到的值转成文本：对象和数组为 JSON，其它按 String() */
export const valueToText = (value: unknown): string => (
  value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value)
);

export const compareValues = (actualValue: unknown, operator: string, expectedValue: unknown): boolean => {
  const actual = valueToText(actualValue);
  const expected = String(expectedValue);
  switch (operator) {
    case 'equals':
      return actual === expected;
    case 'notEquals':
      return actual !== expected;
    case 'contains':
      return actual.includes(expected);
    case 'notContains':
      return !actual.includes(expected);
    case 'exists':
      return actualValue !== undefined && actualValue !== null;
    case 'notExists':
      return actualValue === undefined || actualValue === null;
    case 'greaterThan':
      return Number(actualValue) > Number(expectedValue);
    case 'lessThan':
      return Number(actualValue) < Number(expectedValue);
    case 'greaterThanOrEquals':
      return Number(actualValue) >= Number(expectedValue);
    case 'lessThanOrEquals':
      return Number(actualValue) <= Number(expectedValue);
    default:
      return false;
  }
};

const EXPECTATIONS: Record<string, string> = {
  equals: '',
  notEquals: 'not ',
  contains: 'to contain ',
  notContains: 'not to contain ',
  greaterThan: 'greater than ',
  lessThan: 'less than ',
  greaterThanOrEquals: 'at least ',
  lessThanOrEquals: 'at most ',
};

/** 断言结果说明，例如 "Status code: expected 201, got 422"、"id: expected not o-1, got o-1" */
export const describeComparison = (label: string, actualValue: unknown, operator: string, expectedValue: unknown): string => {
  const got = `got ${valueToText(actualValue)}`;
  if (operator === 'exists') return `${label}: expected to exist, ${got}`;
  if (operator === 'notExists') return `${label}: expected not to exist, ${got}`;
  const prefix = EXPECTATIONS[operator] ?? `${operator} `;
  return `${label}: expected ${prefix}${String(expectedValue)}, ${got}`;
};
