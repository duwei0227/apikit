// 删除请求或 Workflow 后通知界面关闭对应页签。界面上的删除通过组件事件处理，
// 不经过界面的删除（例如 MCP）调用 notifyItemDeleted。

export type DeletedItemKind = 'request' | 'workflow';
type DeletedItemListener = (kind: DeletedItemKind, id: string) => void;

const listeners = new Set<DeletedItemListener>();

/** 订阅删除通知，返回取消订阅的函数 */
export function onItemDeleted(listener: DeletedItemListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyItemDeleted(kind: DeletedItemKind, id: string) {
  listeners.forEach(listener => listener(kind, id));
}
