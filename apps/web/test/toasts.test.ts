import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOAST_MS, toast, toasts } from '../src/ui/toasts';

describe('toasts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toasts.setState({ items: [] });
  });
  afterEach(() => vi.useRealTimers());

  it('queues messages and dismisses each after TOAST_MS', () => {
    toast('Link copied');
    vi.advanceTimersByTime(1000);
    toast('Page deleted');
    expect(toasts.getState().items.map((t) => t.message)).toEqual(['Link copied', 'Page deleted']);
    vi.advanceTimersByTime(TOAST_MS - 1000);
    expect(toasts.getState().items.map((t) => t.message)).toEqual(['Page deleted']);
    vi.advanceTimersByTime(1000);
    expect(toasts.getState().items).toEqual([]);
  });
});
