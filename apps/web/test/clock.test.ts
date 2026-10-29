import { describe, expect, it } from 'vitest';
import {
  boardAccess,
  capability,
  INITIAL_CLOCK,
  mayDelete,
  mayEdit,
  nextClock,
} from '../src/sync/clock';

describe('clock', () => {
  it('hello sets the role, the offset and whether the board is full', () => {
    expect(
      nextClock(INITIAL_CLOCK, { type: 'hello', role: 'edit', now: 10_500, full: true }, 10_000),
    ).toEqual({ role: 'edit', offset: 500, viewKey: null, full: true, unsaved: false });
  });

  /** A client that has been told everything: a view key, a full board, a refused change. */
  const told = {
    role: 'edit' as const,
    offset: 500,
    viewKey: 'vk',
    full: true,
    unsaved: true,
  };

  it('time refreshes the offset and keeps everything else', () => {
    expect(nextClock(told, { type: 'time', now: 20_000 }, 20_100)).toEqual({
      role: 'edit',
      offset: -100,
      viewKey: 'vk',
      full: true,
      unsaved: true,
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

  it('room switches full on and off, refreshes the offset and keeps everything else', () => {
    const open = nextClock(told, { type: 'room', full: false, now: 30_000 }, 30_250);
    expect(open).toEqual({
      role: 'edit',
      offset: -250,
      viewKey: 'vk',
      full: false,
      unsaved: true,
    });
    expect(nextClock(open, { type: 'room', full: true, now: 40_400 }, 40_000)).toEqual({
      ...open,
      offset: 400,
      full: true,
    });
  });

  it('rejected marks unsaved changes, and a later hello does not clear the mark', () => {
    const editor = { ...told, unsaved: false };
    const unsaved = nextClock(editor, { type: 'rejected', now: 50_300 }, 50_000);
    expect(unsaved).toEqual({
      role: 'edit',
      offset: 300,
      viewKey: 'vk',
      full: true,
      unsaved: true,
    });
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

describe('boardAccess', () => {
  it('a viewer is read-only, an editor on a full board only deletes, and an unknown role edits', () => {
    expect(boardAccess({ role: 'view', full: false })).toBe('read-only');
    expect(boardAccess({ role: 'view', full: true })).toBe('read-only');
    expect(boardAccess({ role: 'edit', full: false })).toBe('edit');
    expect(boardAccess({ role: 'edit', full: true })).toBe('delete-only');
    expect(boardAccess({ role: null, full: false })).toBe('edit');
  });

  it('an unknown role on a board known to be full still edits: the room message came first', () => {
    expect(boardAccess({ role: null, full: true })).toBe('edit');
  });
});
