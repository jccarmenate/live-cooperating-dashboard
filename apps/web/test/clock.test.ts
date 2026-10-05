import { describe, expect, it } from 'vitest';
import { capability, INITIAL_CLOCK, mayDelete, mayEdit, nextClock } from '../src/sync/clock';

describe('clock', () => {
  it('hello sets the role, the offset and whether the board is full', () => {
    expect(
      nextClock(INITIAL_CLOCK, { type: 'hello', role: 'edit', now: 10_500, full: true }, 10_000),
    ).toEqual({ role: 'edit', offset: 500, viewKey: null, full: true, unsaved: false });
  });

  it('time refreshes the offset and keeps everything else', () => {
    const prev = { ...INITIAL_CLOCK, role: 'view' as const, offset: 500, full: true };
    expect(nextClock(prev, { type: 'time', now: 20_000 }, 20_100)).toEqual({
      ...prev,
      offset: -100,
    });
  });

  it('keeps the view key from hello and across time refreshes', () => {
    const a = nextClock(
      INITIAL_CLOCK,
      { type: 'hello', role: 'edit', now: 5, full: false, viewKey: 'vk' },
      5,
    );
    expect(a.viewKey).toBe('vk');
    expect(nextClock(a, { type: 'time', now: 9 }, 9).viewKey).toBe('vk');
  });

  it('room switches full on and off', () => {
    const editor = { ...INITIAL_CLOCK, role: 'edit' as const };
    const full = nextClock(editor, { type: 'room', full: true, now: 1 }, 1);
    expect(full.full).toBe(true);
    expect(nextClock(full, { type: 'room', full: false, now: 2 }, 2).full).toBe(false);
  });

  it('rejected marks unsaved changes, and a later hello does not clear the mark', () => {
    const editor = { ...INITIAL_CLOCK, role: 'edit' as const };
    const unsaved = nextClock(editor, { type: 'rejected', now: 1 }, 1);
    expect(unsaved.unsaved).toBe(true);
    expect(
      nextClock(unsaved, { type: 'hello', role: 'edit', now: 2, full: false }, 2).unsaved,
    ).toBe(true);
  });
});

describe('capability', () => {
  it('an editor edits, deletes only on a full board, and anyone else views', () => {
    expect(capability({ role: 'edit', full: false })).toBe('edit');
    expect(capability({ role: 'edit', full: true })).toBe('delete-only');
    expect(capability({ role: 'view', full: false })).toBe('view');
    expect(capability({ role: 'view', full: true })).toBe('view');
    expect(capability({ role: null, full: false })).toBe('view');
  });

  it('mayEdit and mayDelete follow it', () => {
    expect(mayEdit({ role: 'edit', full: false })).toBe(true);
    expect(mayEdit({ role: 'edit', full: true })).toBe(false);
    expect(mayDelete({ role: 'edit', full: true })).toBe(true);
    expect(mayDelete({ role: 'view', full: false })).toBe(false);
  });
});
