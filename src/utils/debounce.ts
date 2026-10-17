// Debounce utility for delaying function execution

/**
 * Creates a debounced function that delays invoking func until after wait milliseconds
 * have elapsed since the last time the debounced function was invoked.
 * 
 * @param func - The function to debounce
 * @param wait - The number of milliseconds to delay
 * @returns A debounced version of the function
 */
export function debounce<A extends unknown[]>(
  func: (...args: A) => unknown,
  wait: number
): ((...args: A) => void) & { cancel: () => void } {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const executedFunction = (...args: A) => {
    const later = () => {
      timeout = null;
      func(...args);
    };

    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(later, wait);
  };

  /** 取消还没执行的调用 */
  const cancel = () => {
    if (timeout) clearTimeout(timeout);
    timeout = null;
  };

  return Object.assign(executedFunction, { cancel });
}

/**
 * Creates a debounced async function
 * 
 * @param func - The async function to debounce
 * @param wait - The number of milliseconds to delay
 * @returns A debounced version of the async function
 */
export function debounceAsync<A extends unknown[], R>(
  func: (...args: A) => Promise<R>,
  wait: number
): (...args: A) => Promise<R> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let pendingPromise: Promise<R> | null = null;

  return function executedFunction(...args: A): Promise<R> {
    if (timeout) {
      clearTimeout(timeout);
    }

    if (!pendingPromise) {
      pendingPromise = new Promise((resolve, reject) => {
        timeout = setTimeout(async () => {
          try {
            const result = await func(...args);
            resolve(result);
          } catch (error) {
            reject(error);
          } finally {
            timeout = null;
            pendingPromise = null;
          }
        }, wait);
      });
    }

    return pendingPromise;
  };
}
