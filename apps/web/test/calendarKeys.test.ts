import { describe, expect, it } from 'vitest';
import { calendarKey } from '../src/calendar/useCalendarKeys';

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
