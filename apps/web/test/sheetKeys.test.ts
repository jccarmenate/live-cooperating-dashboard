import { describe, expect, it } from 'vitest';
import { typedChar } from '../src/sheet/useSheetKeys';

const key = (k: string, mods: { ctrl?: boolean; alt?: boolean; meta?: boolean } = {}) => ({
  key: k,
  ctrlKey: mods.ctrl ?? false,
  altKey: mods.alt ?? false,
  metaKey: mods.meta ?? false,
});

describe('typedChar', () => {
  it('types plain printable keys', () => {
    expect(typedChar(key('a'), false)).toBe('a');
    expect(typedChar(key('='), true)).toBe('=');
  });

  it('types AltGr characters (Ctrl+Alt on Windows) and Option characters on macOS', () => {
    expect(typedChar(key('@', { ctrl: true, alt: true }), false)).toBe('@');
    expect(typedChar(key('€', { ctrl: true, alt: true }), false)).toBe('€');
    expect(typedChar(key('@', { alt: true }), true)).toBe('@');
  });

  it('ignores shortcuts and other Alt combos', () => {
    expect(typedChar(key('b', { ctrl: true }), false)).toBeNull();
    expect(typedChar(key('b', { meta: true }), true)).toBeNull();
    expect(typedChar(key('d', { alt: true }), false)).toBeNull();
    expect(typedChar(key('∂', { ctrl: true, alt: true }), true)).toBeNull();
    expect(typedChar(key('ArrowUp', { alt: true }), false)).toBeNull();
    expect(typedChar(key('Enter'), false)).toBeNull();
  });
});
