// Stable identity for editable table rows (params / headers / form-data / tests ...).
//
// Rows are plain persisted objects without an id, so lists used to be keyed by
// index. With index keys, deleting a row makes Vue reuse the following row's
// input components for different data, and their undo/redo history ends up on
// the wrong row. getRowKey() gives every row object a stable, non-persisted key.

import { toRaw } from 'vue';

const rowKeys = new WeakMap<object, string>();
let nextRowKey = 0;

export const getRowKey = (row: object): string => {
  const raw = toRaw(row);
  let key = rowKeys.get(raw);
  if (!key) {
    nextRowKey += 1;
    key = `row-${nextRowKey}`;
    rowKeys.set(raw, key);
  }
  return key;
};

/**
 * Update `current` in place so it matches `next`, reusing existing row objects
 * position by position. Keeps row identity (and the inputs bound to it, with
 * their undo history) when a table is rebuilt from another source, e.g. query
 * params re-parsed from the URL.
 */
export const reconcileRows = <T extends object>(current: T[], next: T[]): T[] => {
  next.forEach((nextRow, index) => {
    const row = current[index];
    if (!row) {
      current.push({ ...nextRow });
      return;
    }
    const fields = row as Record<string, unknown>;
    Object.keys(fields).forEach(field => {
      if (!(field in nextRow)) delete fields[field];
    });
    Object.entries(nextRow).forEach(([field, value]) => {
      if (fields[field] !== value) fields[field] = value;
    });
  });
  if (current.length > next.length) current.splice(next.length);
  return current;
};
