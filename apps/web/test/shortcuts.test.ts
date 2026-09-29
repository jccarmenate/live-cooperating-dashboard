import { describe, expect, it } from 'vitest';
import { gateByRole, type KeyInput, keyDownAction, keyUpAction } from '../src/ui/shortcuts';

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

  it('M selects the comment tool', () => {
    expect(keyDownAction(k('m'), false)).toEqual({
      type: 'dispatch',
      event: { type: 'setTool', tool: 'comment' },
      preventDefault: false,
    });
  });

  it('M reaches the comment tool only for editors; other shortcuts pass through', () => {
    const m = keyDownAction(k('m'), false);
    expect(gateByRole(m, 'edit')).toEqual(m);
    expect(gateByRole(m, 'view')).toBeNull();
    expect(gateByRole(m, null)).toBeNull();
    const rect = keyDownAction(k('r'), false);
    expect(gateByRole(rect, 'view')).toEqual(rect);
    expect(gateByRole({ type: 'undo' }, 'edit')).toEqual({ type: 'undo' });
    expect(gateByRole(null, 'edit')).toBeNull();
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
    expect(keyDownAction(k('r', { ctrlKey: true }), false)).toBeNull();
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

describe('canvas UX shortcuts', () => {
  const key = (k: string, extra: Partial<KeyInput> = {}): KeyInput => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...extra,
  });

  it('maps Ctrl/⌘+D and Ctrl/⌘+A', () => {
    expect(keyDownAction(key('d', { ctrlKey: true }), false)).toEqual({ type: 'duplicate' });
    expect(keyDownAction(key('a', { metaKey: true }), false)).toEqual({ type: 'selectAll' });
    expect(keyDownAction(key('a', { ctrlKey: true }), true)).toBeNull();
  });

  it('maps ] and [ to z-order, Shift+1 to zoom to fit and ? to help', () => {
    expect(keyDownAction(key(']'), false)).toEqual({ type: 'z', where: 'front' });
    expect(keyDownAction(key('['), false)).toEqual({ type: 'z', where: 'back' });
    expect(keyDownAction(key('!', { shiftKey: true, code: 'Digit1' }), false)).toEqual({
      type: 'zoomToFit',
    });
    expect(keyDownAction(key('?', { shiftKey: true }), false)).toEqual({ type: 'help' });
  });

  it('maps the physical [ and ] keys to z-order on layouts where they type something else', () => {
    expect(keyDownAction(key('Dead', { code: 'BracketLeft' }), false)).toEqual({
      type: 'z',
      where: 'back',
    });
    expect(keyDownAction(key('+', { code: 'BracketRight' }), false)).toEqual({
      type: 'z',
      where: 'front',
    });
    expect(keyDownAction(key('+', { code: 'BracketRight', ctrlKey: true }), false)).toBeNull();
    expect(keyDownAction(key('+', { code: 'BracketRight', metaKey: true }), false)).toBeNull();
    expect(keyDownAction(key('+', { code: 'BracketRight', altKey: true }), false)).toBeNull();
    expect(keyDownAction(key('+', { code: 'BracketRight' }), true)).toBeNull();
  });

  it('viewers cannot duplicate or restack but can select all, fit and open help', () => {
    expect(gateByRole({ type: 'duplicate' }, 'view')).toBeNull();
    expect(gateByRole({ type: 'z', where: 'front' }, 'view')).toBeNull();
    expect(gateByRole({ type: 'selectAll' }, 'view')).toEqual({ type: 'selectAll' });
    expect(gateByRole({ type: 'zoomToFit' }, null)).toEqual({ type: 'zoomToFit' });
    expect(gateByRole({ type: 'help' }, 'view')).toEqual({ type: 'help' });
    expect(gateByRole({ type: 'duplicate' }, 'edit')).toEqual({ type: 'duplicate' });
  });

  const down = (key: string, mods: Partial<KeyInput> = {}) => keyDownAction(k(key, mods), false);
  const mutating: [string, ReturnType<typeof keyDownAction>][] = [
    ['Delete', down('Delete')],
    ['Backspace', down('Backspace')],
    ['ArrowLeft (nudge)', down('ArrowLeft')],
    ['Shift+ArrowDown (nudge)', down('ArrowDown', { shiftKey: true })],
    ['E (toggle routing)', down('e')],
    ['Ctrl+D (duplicate)', down('d', { ctrlKey: true })],
    [']', down(']')],
    ['[', down('[')],
    ['Ctrl+Z (undo)', down('z', { ctrlKey: true })],
    ['Ctrl+Y (redo)', down('y', { ctrlKey: true })],
    ['Ctrl+Shift+Z (redo)', down('Z', { ctrlKey: true, shiftKey: true })],
    ['M (comment tool)', down('m')],
  ];
  const harmless: [string, ReturnType<typeof keyDownAction>][] = [
    ['Ctrl+A (select all)', down('a', { ctrlKey: true })],
    ['Shift+1 (zoom to fit)', down('!', { shiftKey: true, code: 'Digit1' })],
    ['? (help)', down('?')],
    ['V (select tool)', down('v')],
    ['R (rect tool)', down('r')],
    ['Space', down(' ')],
    ['Escape (cancel)', down('Escape')],
  ];

  for (const role of ['view', null] as const) {
    it.each(mutating)(`role ${role}: drops %s`, (_name, action) => {
      expect(action).not.toBeNull();
      expect(gateByRole(action, role)).toBeNull();
    });
    it.each(harmless)(`role ${role}: keeps %s`, (_name, action) => {
      expect(action).not.toBeNull();
      expect(gateByRole(action, role)).toEqual(action);
    });
  }

  it.each([...mutating, ...harmless])('editors keep %s', (_name, action) => {
    expect(gateByRole(action, 'edit')).toEqual(action);
  });
});

describe('graph menu key', () => {
  it('G opens the graph menu for everyone', () => {
    const g = { key: 'g', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };
    expect(keyDownAction(g, false)).toEqual({ type: 'graphMenu' });
    expect(gateByRole({ type: 'graphMenu' }, 'view')).toEqual({ type: 'graphMenu' });
  });
});
