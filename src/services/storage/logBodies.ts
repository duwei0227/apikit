// Console 和 History 的 body 单独保存为每条一个文件：发送请求时只写这一条，展开或打开时再读取

import type { LogBodies, LogBodyKind } from '@/types/models';
import { storageService } from '@/services/storage';

export interface LogBodyStore<K extends LogBodyKind> {
  /** 安排写入一条 body；写完之前 load 直接返回这份内容 */
  save(id: string, body: LogBodies[K]): void;
  load(id: string): Promise<LogBodies[K] | null>;
  /** 删除这些条目的 body */
  remove(ids: string[]): void;
  /** 只保留这些条目的 body，其余的（包括崩溃后残留的）删除 */
  keepOnly(ids: string[]): void;
  /** 等待已安排的写入和删除完成 */
  flush(): Promise<void>;
}

export function createLogBodyStore<K extends LogBodyKind>(kind: K): LogBodyStore<K> {
  const pending = new Map<string, LogBodies[K]>();
  // 写入和删除按顺序执行，避免删除跑在同一条的写入之前
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<void>, label: string) => {
    queue = queue.then(task).catch(error => console.error(`Failed to ${label} ${kind} log bodies:`, error));
  };

  return {
    save(id, body) {
      pending.set(id, body);
      enqueue(async () => {
        try {
          await storageService.saveLogBody(kind, id, body);
        } finally {
          if (pending.get(id) === body) pending.delete(id);
        }
      }, 'save');
    },
    async load(id) {
      const body = pending.get(id);
      if (body) return body;
      try {
        return await storageService.loadLogBody(kind, id);
      } catch (error) {
        console.error(`Failed to load ${kind} log body:`, error);
        return null;
      }
    },
    remove(ids) {
      if (ids.length === 0) return;
      ids.forEach(id => pending.delete(id));
      enqueue(() => storageService.deleteLogBodies(kind, ids), 'delete');
    },
    keepOnly(ids) {
      const keep = new Set(ids);
      [...pending.keys()].forEach(id => { if (!keep.has(id)) pending.delete(id); });
      enqueue(() => storageService.deleteLogBodiesExcept(kind, ids), 'clean up');
    },
    flush() {
      return queue;
    },
  };
}

/** 被清理掉的条目：在 before 中但不在 after 中 */
export function removedLogIds<T extends { id: string | number }>(before: T[], after: T[]): string[] {
  const kept = new Set(after.map(entry => String(entry.id)));
  return before.map(entry => String(entry.id)).filter(id => !kept.has(id));
}
