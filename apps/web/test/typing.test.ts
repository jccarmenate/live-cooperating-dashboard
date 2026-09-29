import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTyping, leavesKeyAlone } from '../src/ui/typing';

// The tests run without a DOM: a minimal HTMLElement stands in for focused elements.
class FakeElement {
  constructor(
    readonly tagName: string,
    readonly isContentEditable = false,
  ) {}
}

describe('isTyping', () => {
  beforeEach(() => {
    vi.stubGlobal('HTMLElement', FakeElement);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is true for text fields, content-editable elements and selects', () => {
    expect(isTyping(new FakeElement('INPUT') as unknown as EventTarget)).toBe(true);
    expect(isTyping(new FakeElement('TEXTAREA') as unknown as EventTarget)).toBe(true);
    expect(isTyping(new FakeElement('DIV', true) as unknown as EventTarget)).toBe(true);
    expect(isTyping(new FakeElement('SELECT') as unknown as EventTarget)).toBe(true);
  });

  it('is false for buttons, the canvas and no target', () => {
    expect(isTyping(new FakeElement('BUTTON') as unknown as EventTarget)).toBe(false);
    expect(isTyping(new FakeElement('svg') as unknown as EventTarget)).toBe(false);
    expect(isTyping(null)).toBe(false);
  });

  it('a focused select keeps its keys, except Escape, which still reaches the board', () => {
    const select = new FakeElement('SELECT') as unknown as EventTarget;
    const input = new FakeElement('INPUT') as unknown as EventTarget;
    for (const key of ['ArrowDown', 'ArrowUp', 'Backspace', 'Delete', 'g', 'r']) {
      expect(leavesKeyAlone(select, key)).toBe(true);
    }
    expect(leavesKeyAlone(select, 'Escape')).toBe(false);
    expect(leavesKeyAlone(input, 'Escape')).toBe(true);
    expect(leavesKeyAlone(new FakeElement('BUTTON') as unknown as EventTarget, 'r')).toBe(false);
  });
});
