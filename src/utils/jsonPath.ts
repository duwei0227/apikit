// 按简单的 JSONPath（$.a.b[0].c）取值：断言、变量提取、Workflow 条件和 Mock 规则共用

export const extractValueFromJsonPath = (jsonData: unknown, path: string): unknown => {
  try {
    const cleanPath = path.replace(/^\$\.?/, '');
    const parts = cleanPath.split(/\.|\[|\]/).filter(Boolean);

    let value = jsonData;
    for (const part of parts) {
      if (value === null || value === undefined) return undefined;
      value = (value as Record<string, unknown>)[part];
    }
    return value;
  } catch {
    return undefined;
  }
};
