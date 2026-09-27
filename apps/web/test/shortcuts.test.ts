import { describe, expect, it } from 'vitest';
import { type KeyInput, keyDownAction, keyUpAction } from '../src/ui/shortcuts';

const k = (key: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('keyboard shortcuts', () => {
  it('maps tool keys, including A (connector) and F (frame), case-insensitively', () => {
    expect(keyDownAction(k('a'), false)).toEqual({
      type: 'dispatch',
      event: { type: 'setTool', tool: 'connector' },
      preventDefault: false,
    });
    expect(keyDownAction(k('F', { shiftKey: true }), false)).toEqual({
      type: 'dispatch',
      event: { type: 'setTool', tool: 'frame' },
      preventDefault: false,
    });
  });

  it('E toggles connector routing', () => {
    expect(keyDownAction(k('e'), false)).toEqual({
      type: 'dispatch',
      event: { type: 'toggleRouting' },
      preventDefault: false,
    });
  });

  it('ignores everything while typing or with Alt', () => {
    expect(keyDownAction(k('a'), true)).toBeNull();
    expect(keyDownAction(k(' '), true)).toBeNull();
    expect(keyDownAction(k('z', { ctrlKey: true }), true)).toBeNull();
    expect(keyDownAction(k('a', { altKey: true }), false)).toBeNull();
  });

  it('maps undo and redo on Ctrl and Cmd', () => {
    expect(keyDownAction(k('z', { ctrlKey: true }), false)).toEqual({ type: 'undo' });
    expect(keyDownAction(k('z', { metaKey: true }), false)).toEqual({ type: 'undo' });
    expect(keyDownAction(k('Z', { ctrlKey: true, shiftKey: true }), false)).toEqual({
      type: 'redo',
    });
    expect(keyDownAction(k('y', { ctrlKey: true }), false)).toEqual({ type: 'redo' });
    expect(keyDownAction(k('a', { ctrlKey: true }), false)).toBeNull();
  });

  it('Space holds and releases the pan mode', () => {
    expect(keyDownAction(k(' '), false)).toEqual({ type: 'space', held: true });
    expect(keyUpAction(k(' '))).toEqual({ type: 'space', held: false });
    expect(keyUpAction(k('a'))).toBeNull();
  });

  it('nudges (Shift = 10), deletes and cancels', () => {
    expect(keyDownAction(k('ArrowLeft', { shiftKey: true }), false)).toEqual({
      type: 'dispatch',
      event: { type: 'nudge', dx: -10, dy: 0 },
      preventDefault: true,
    });
    expect(keyDownAction(k('ArrowDown'), false)).toEqual({
      type: 'dispatch',
      event: { type: 'nudge', dx: 0, dy: 1 },
      preventDefault: true,
    });
    expect(keyDownAction(k('Backspace'), false)).toEqual({
      type: 'dispatch',
      event: { type: 'deleteSelection' },
      preventDefault: true,
    });
    expect(keyDownAction(k('Escape'), false)).toEqual({
      type: 'dispatch',
      event: { type: 'cancel' },
      preventDefault: false,
    });
  });
});
