// useVisitedTabs - render a tab's content the first time it is shown, then keep
// it mounted (hidden with v-show by the tab container) when switching away.
//
// A fully lazy TabView destroys the inactive panel, which also throws away the
// undo/redo history of every editor inside it. Rendering every panel eagerly
// costs startup time for each open request. Mount-on-first-visit keeps both.

import { reactive, watch, type Ref } from 'vue';

export function useVisitedTabs<T>(active: Ref<T>) {
  const visited = reactive(new Set<T>()) as Set<T>;

  watch(active, value => {
    visited.add(value);
  }, { immediate: true });

  const isVisited = (value: T) => visited.has(value);

  return { isVisited };
}
