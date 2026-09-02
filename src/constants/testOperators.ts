// Shared test-assertion operators — used by the request Tests editor
// (operator dropdowns) and the response Test Results display.

export interface TestOperatorOption {
  label: string;
  value: string;
}

export const operatorOptions: TestOperatorOption[] = [
  { label: 'Equals (=)', value: 'equals' },
  { label: 'Not Equals (≠)', value: 'notEquals' },
  { label: 'Greater Than (>)', value: 'greaterThan' },
  { label: 'Less Than (<)', value: 'lessThan' },
  { label: 'Greater Than or Equal (≥)', value: 'greaterThanOrEquals' },
  { label: 'Less Than or Equal (≤)', value: 'lessThanOrEquals' },
  { label: 'Contains', value: 'contains' },
  { label: 'Does Not Contain', value: 'notContains' },
  { label: 'Exists', value: 'exists' },
  { label: 'Does Not Exist', value: 'notExists' },
];

// 获取操作符的显示文本
export const getOperatorLabel = (operatorValue: string): string => {
  const operator = operatorOptions.find(op => op.value === operatorValue);
  return operator ? operator.label : operatorValue;
};
