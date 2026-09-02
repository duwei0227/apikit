// useKeyValueRows - reusable add / remove / auto-empty-row logic for
// editable key-value tables (query params, headers, form-data, urlencoded,
// environment variables, ...).
//
// Behavior is a faithful extraction of the previously duplicated inline
// handlers in HttpRequest.vue / EnvironmentManager.vue:
//   - add():       append a fresh empty row.
//   - remove(i):   splice row i; when at the minimum row count either keep
//                  the table untouched ('splice') or reset the single row to
//                  empty ('replaceLast', used by query params).
//   - onChange():  if the last row has content and no empty row exists yet,
//                  append one; then run an optional side effect (e.g. URL sync).
//
// The rows array is accessed lazily via getRows() because the underlying
// container ref (e.g. localRequest.value.params) can be reassigned wholesale.

export interface KeyValueRowsOptions<T> {
  /** Lazily returns the current rows array (must return the live array). */
  getRows: () => T[];
  /** Factory for a fresh empty row. */
  createRow: () => T;
  /** Whether a row is considered empty. Defaults to empty key AND value. */
  isEmpty?: (row: T) => boolean;
  /** Minimum number of rows kept. Defaults to 1. */
  minRows?: number;
  /** What to do on remove when already at minRows. Defaults to 'splice' (no-op). */
  removeStrategy?: 'splice' | 'replaceLast';
  /** Optional side effect run at the end of onChange (e.g. sync URL from params). */
  onAfterChange?: () => void;
}

export function useKeyValueRows<T extends Record<string, any>>(
  options: KeyValueRowsOptions<T>,
) {
  const {
    getRows,
    createRow,
    isEmpty = (row: any) => !row.key && !row.value,
    minRows = 1,
    removeStrategy = 'splice',
    onAfterChange,
  } = options;

  const add = () => {
    getRows().push(createRow());
  };

  const remove = (index: number) => {
    const rows = getRows();
    if (rows.length > minRows) {
      rows.splice(index, 1);
    } else if (removeStrategy === 'replaceLast') {
      rows[0] = createRow();
    }
  };

  const onChange = () => {
    const rows = getRows();
    const last = rows[rows.length - 1];
    if (last && !isEmpty(last)) {
      if (!rows.some(isEmpty)) {
        add();
      }
    }
    onAfterChange?.();
  };

  return { add, remove, onChange };
}
