import { describe, expect, it } from 'vitest';
import {
  BUTTON_SELECTOR,
  calendarKey,
  DIALOG_SELECTOR,
  keyLeftToFocus,
  LIST_SELECTOR,
} from '../src/calendar/useCalendarKeys';

/** A focused element inside the given kind of control (or none). */
const inside = (selector: string | null) => ({
  closest: (s: string) => (s === selector ? {} : null),
});

const k = (
  key: string,
  mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {},
) => calendarKey({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

describe('calendar keys', () => {
  it('maps the calendar shortcuts', () => {
    expect(k('t')).toBe('today');
    expect(k('T')).toBe('today');
    expect(k('m')).toBe('month');
    expect(k('w')).toBe('week');
    expect(k('ArrowLeft')).toBe('prev');
    expect(k('ArrowRight')).toBe('next');
    expect(k('n')).toBe('new');
    expect(k('Enter')).toBe('open');
    expect(k('Delete')).toBe('delete');
    expect(k('Backspace')).toBe('delete');
    expect(k('Escape')).toBe('deselect');
    expect(k('z', { ctrlKey: true })).toBe('undo');
    expect(k('z', { metaKey: true, shiftKey: true })).toBe('redo');
    expect(k('y', { ctrlKey: true })).toBe('redo');
  });

  it('ignores other keys and modified letters', () => {
    expect(k('x')).toBeNull();
    expect(k('t', { ctrlKey: true })).toBeNull();
    expect(k('n', { altKey: true })).toBeNull();
    expect(k('ArrowLeft', { shiftKey: true })).toBeNull();
  });
});

describe('keys left to the focused control', () => {
  it('a focused button keeps only Enter and Space', () => {
    const button = inside(BUTTON_SELECTOR);
    expect(keyLeftToFocus(button, 'Enter')).toBe(true);
    expect(keyLeftToFocus(button, ' ')).toBe(true);
    for (const key of ['ArrowRight', 'ArrowLeft', 'm', 'w', 't', 'n', 'Delete', 'Escape', 'z'])
      expect(keyLeftToFocus(button, key)).toBe(false);
  });

  it('a focused select or menu keeps arrows, Enter and Space', () => {
    const list = inside(LIST_SELECTOR);
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '])
      expect(keyLeftToFocus(list, key)).toBe(true);
    expect(keyLeftToFocus(list, 'm')).toBe(false);
    expect(keyLeftToFocus(list, 'Escape')).toBe(false);
  });

  it('a dialog keeps every key; no focus keeps none', () => {
    expect(keyLeftToFocus(inside(DIALOG_SELECTOR), 'm')).toBe(true);
    expect(keyLeftToFocus(inside(null), 'Enter')).toBe(false);
    expect(keyLeftToFocus(null, 'Enter')).toBe(false);
  });
});
