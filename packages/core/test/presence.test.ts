import { describe, expect, it } from 'vitest';
import {
  IDENTITY_KEY,
  type Identity,
  initials,
  isIdentity,
  loadIdentity,
  makeIdentity,
  onlineUsers,
  type Peer,
  PRESENCE_COLORS,
  parsePresence,
  peersFrom,
} from '../src';

const alice: Identity = { id: 'a', name: 'Brisk Otter', color: '#E85A1B' };
const bob: Identity = { id: 'b', name: 'Calm Heron', color: '#3B3BF5' };

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

describe('identity', () => {
  it('makeIdentity is deterministic given rand and uuid', () => {
    const id = makeIdentity(
      () => 0,
      () => 'uuid-1',
    );
    expect(id).toEqual({ id: 'uuid-1', name: 'Brisk Otter', color: PRESENCE_COLORS[0] });
    expect(isIdentity(id)).toBe(true);
  });

  it('loadIdentity persists and reuses the identity', () => {
    const storage = new MemoryStorage();
    const first = loadIdentity(storage, () => alice);
    const second = loadIdentity(storage, () => bob);
    expect(first).toEqual(alice);
    expect(second).toEqual(alice);
  });

  it('loadIdentity replaces corrupt data and tolerates missing storage', () => {
    const storage = new MemoryStorage();
    storage.setItem(IDENTITY_KEY, '{not json');
    expect(loadIdentity(storage, () => bob)).toEqual(bob);
    expect(loadIdentity(null, () => alice)).toEqual(alice);
  });

  it('initials', () => {
    expect(initials('Brisk Otter')).toBe('BO');
    expect(initials('mara')).toBe('M');
    expect(initials('  ')).toBe('?');
  });
});

describe('presence parsing', () => {
  it('parsePresence validates and defaults fields', () => {
    expect(parsePresence(null)).toBeNull();
    expect(parsePresence({ user: { id: 1 } })).toBeNull();
    expect(parsePresence({ user: alice })).toEqual({
      user: alice,
      cursor: null,
      selection: [],
      editing: null,
      viewport: null,
      page: null,
    });
    expect(
      parsePresence({ user: alice, cursor: { x: 1, y: 2 }, selection: ['s1', 7], editing: 's1' }),
    ).toEqual({
      user: alice,
      cursor: { x: 1, y: 2 },
      selection: ['s1'],
      editing: 's1',
      viewport: null,
      page: null,
    });
  });

  it('rejects a user.color that is not a plain #rrggbb hex value', () => {
    // user.color is used verbatim in inline `style.background`; anything
    // other than a strict 6-hex-digit color (e.g. `url(https://evil)`) could
    // leak a viewer's IP to a peer-controlled URL.
    expect(parsePresence({ user: { ...alice, color: 'url(https://evil.example)' } })).toBeNull();
    expect(parsePresence({ user: { ...alice, color: 'red' } })).toBeNull();
    expect(parsePresence({ user: { ...alice, color: '#E85A1' } })).toBeNull();
    expect(parsePresence({ user: { ...alice, color: '#E85A1BFF' } })).toBeNull();
    expect(parsePresence({ user: { ...alice, color: '#e85a1b' } })).toEqual({
      user: { ...alice, color: '#e85a1b' },
      cursor: null,
      selection: [],
      editing: null,
      viewport: null,
      page: null,
    });
  });

  it('rejects a user.id longer than 64 characters', () => {
    expect(parsePresence({ user: { ...alice, id: 'x'.repeat(65) } })).toBeNull();
    expect(parsePresence({ user: { ...alice, id: 'x'.repeat(64) } })).toEqual({
      user: { ...alice, id: 'x'.repeat(64) },
      cursor: null,
      selection: [],
      editing: null,
      viewport: null,
      page: null,
    });
  });

  it('parsePresence accepts only a finite, positive, bounded viewport', () => {
    const vp = { x: -10, y: 20, w: 800, h: 600 };
    expect(parsePresence({ user: alice, viewport: vp })?.viewport).toEqual(vp);
    expect(parsePresence({ user: alice, viewport: { ...vp, extra: 1 } })?.viewport).toEqual(vp);
    for (const bad of [
      { ...vp, w: 0 },
      { ...vp, h: -5 },
      { ...vp, w: 2e6 },
      { ...vp, x: Number.POSITIVE_INFINITY },
      { ...vp, x: 2e9 },
      { x: 0, y: 0 },
      'big',
    ]) {
      expect(parsePresence({ user: alice, viewport: bad })?.viewport).toBeNull();
    }
  });

  it('parsePresence accepts a bounded page id', () => {
    expect(parsePresence({ user: alice, page: 'p2' })?.page).toBe('p2');
    expect(parsePresence({ user: alice, page: 'x'.repeat(65) })?.page).toBeNull();
    expect(parsePresence({ user: alice, page: 7 })?.page).toBeNull();
  });

  it('parsePresence keeps a page id of 1 to 64 characters', () => {
    expect(parsePresence({ user: alice, page: 'x'.repeat(64) })?.page).toBe('x'.repeat(64));
    expect(parsePresence({ user: alice, page: 'x' })?.page).toBe('x');
    expect(parsePresence({ user: alice, page: 'x'.repeat(65) })?.page).toBeNull();
    expect(parsePresence({ user: alice, page: '' })?.page).toBeNull();
  });

  it('peersFrom excludes self and invalid states, sorted by clientId', () => {
    const states = new Map<number, unknown>([
      [3, { user: bob }],
      [1, { user: alice }],
      [2, { garbage: true }],
    ]);
    const peers = peersFrom(states, 1);
    expect(peers.map((p) => p.clientId)).toEqual([3]);
  });

  it('onlineUsers dedupes by user id and lists self first', () => {
    const peers: Peer[] = [
      {
        clientId: 2,
        user: bob,
        cursor: null,
        selection: [],
        editing: null,
        viewport: null,
        page: null,
      },
      {
        clientId: 3,
        user: bob,
        cursor: null,
        selection: [],
        editing: null,
        viewport: null,
        page: null,
      },
      {
        clientId: 4,
        user: alice,
        cursor: null,
        selection: [],
        editing: null,
        viewport: null,
        page: null,
      },
    ];
    expect(onlineUsers(peers, alice)).toEqual([alice, bob]);
  });
});

describe('sheet presence', () => {
  it('keeps a valid sheet selection and drops a malformed one', () => {
    const sheet = { anchor: ['r1', 'c1'], focus: ['r2', 'c3'], editing: true };
    expect(parsePresence({ user: alice, sheet })?.sheet).toEqual(sheet);
    expect(
      parsePresence({ user: alice, sheet: { anchor: ['r1'], focus: ['r2', 'c3'], editing: true } })
        ?.sheet,
    ).toBeUndefined();
    expect(
      parsePresence({
        user: alice,
        sheet: { anchor: ['r1', 'x'.repeat(17)], focus: ['r2', 'c3'], editing: false },
      })?.sheet,
    ).toBeUndefined();
    expect(parsePresence({ user: alice })).not.toHaveProperty('sheet');
  });
});
