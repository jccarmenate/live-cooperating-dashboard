// Web-platform timers exist in browsers, Workers and Node; declared locally so core needs no DOM/Node typings.
declare function setTimeout(handler: () => void, ms?: number): unknown;
declare function clearTimeout(id: unknown): void;

export interface Throttled<A extends unknown[]> {
  (...args: A): void;
  flush(): void;
  cancel(): void;
}

/** Leading + trailing throttle: the latest args win within each window. */
export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number): Throttled<A> {
  let last = Number.NEGATIVE_INFINITY;
  let timer: unknown = null;
  let pending: A | null = null;

  const invoke = () => {
    timer = null;
    if (!pending) return;
    const args = pending;
    pending = null;
    last = Date.now();
    fn(...args);
  };

  const throttled = ((...args: A) => {
    pending = args;
    const wait = ms - (Date.now() - last);
    if (wait <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      invoke();
    } else if (!timer) {
      timer = setTimeout(invoke, wait);
    }
  }) as Throttled<A>;

  throttled.flush = () => {
    if (timer) {
      clearTimeout(timer);
      invoke();
    }
  };
  throttled.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  return throttled;
}
