/**
 * 合并短时间内的多次保存：只在最后一次变更后 delayMs 写一次，并且写入按顺序执行。
 * 写入时才读取最新数据，所以期间的多次变更只序列化一次。
 */
export const createCoalescedPersister = <T>(
  save: (value: T) => Promise<void>,
  delayMs: number = 500,
) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: (() => T) | null = null;
  let queue: Promise<void> = Promise.resolve();

  const run = (): Promise<void> => {
    if (pending) {
      const read = pending;
      pending = null;
      queue = queue.catch(() => undefined).then(() => save(read()));
    }
    return queue;
  };

  const cancelTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    /** 安排一次延迟写入，返回时尚未写盘 */
    schedule(read: () => T) {
      pending = read;
      cancelTimer();
      timer = setTimeout(() => {
        timer = null;
        run().catch(error => console.error('Failed to persist data:', error));
      }, delayMs);
    },
    /** 立即写入（用于清空、删除等用户明确的操作） */
    persistNow(read: () => T): Promise<void> {
      pending = read;
      cancelTimer();
      return run();
    },
    /** 写完所有待写入的数据，退出前调用 */
    flush(): Promise<void> {
      cancelTimer();
      return run();
    },
  };
};
