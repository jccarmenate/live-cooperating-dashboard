import { describe, expect, it } from 'vitest';
import { Awareness, encodeAwarenessUpdate as yEncode } from 'y-protocols/awareness';
import * as Y from 'yjs';
import {
  type AwarenessEntry,
  encodeAwarenessUpdate,
  filterAwareness,
  readAwarenessMessage,
  wrapAwareness,
} from '../src/awareness';

const presence = (name: string, extra: Record<string, unknown> = {}) => ({
  user: { id: `u-${name}`, name, color: '#E85A1B' },
  cursor: null,
  selection: [],
  editing: null,
  viewport: null,
  page: null,
  ...extra,
});
const entry = (clientId: number, clock: number, state: unknown): AwarenessEntry => ({
  clientId,
  clock,
  state: JSON.stringify(state),
});
const ctx = (owned: number[] = [], others: number[] = []) => ({
  owned,
  ownedByOthers: new Set(others),
  maxIds: 2,
});

describe('awareness codec', () => {
  it('round-trips entries', () => {
    const entries = [entry(1, 3, presence('Ann')), entry(2, 9, null)];
    expect(readAwarenessMessage(wrapAwareness(encodeAwarenessUpdate(entries)))).toEqual(entries);
  });

  it('reads what y-protocols writes', () => {
    const a = new Awareness(new Y.Doc());
    a.setLocalState(presence('Ann'));
    const entries = readAwarenessMessage(wrapAwareness(yEncode(a, [a.clientID])));
    expect(entries).toHaveLength(1);
    expect(entries?.[0]?.clientId).toBe(a.clientID);
    expect(JSON.parse(entries?.[0]?.state ?? 'null').user.name).toBe('Ann');
    a.destroy();
  });

  it('rejects a frame that is truncated, has trailing bytes or is not awareness', () => {
    const good = wrapAwareness(encodeAwarenessUpdate([entry(1, 1, presence('Ann'))]));
    expect(readAwarenessMessage(good.slice(0, good.length - 3))).toBeNull();
    expect(readAwarenessMessage(Uint8Array.of(...good, 0))).toBeNull();
    expect(readAwarenessMessage(Uint8Array.of(0, 0))).toBeNull();
    expect(readAwarenessMessage(new Uint8Array())).toBeNull();
  });
});

describe('awareness filter', () => {
  it('claims an unowned id and relays the state reduced to known fields', () => {
    const v = filterAwareness([entry(7, 1, presence('Ann', { junk: 'x' }))], ctx());
    expect(v.tooMany).toBe(false);
    expect(v.owned).toEqual([7]);
    expect(v.accepted).toHaveLength(1);
    const state = JSON.parse(v.accepted[0]?.state ?? 'null');
    expect(state.user.name).toBe('Ann');
    expect('junk' in state).toBe(false);
  });

  it('drops an entry for an id another connection owns', () => {
    const v = filterAwareness([entry(7, 5, presence('Mallory')), entry(7, 6, null)], ctx([], [7]));
    expect(v.accepted).toEqual([]);
    expect(v.owned).toEqual([]);
  });

  it('drops a state that is not valid presence, without claiming the id', () => {
    const v = filterAwareness(
      [entry(7, 1, { name: 'INTRUDER' }), { clientId: 8, clock: 1, state: '{not json' }],
      ctx(),
    );
    expect(v.accepted).toEqual([]);
    expect(v.owned).toEqual([]);
  });

  it('accepts a removal only for an owned id, and releases it', () => {
    expect(filterAwareness([entry(7, 2, null)], ctx()).accepted).toEqual([]);
    const v = filterAwareness([entry(7, 2, null)], ctx([7]));
    expect(v.accepted).toEqual([{ clientId: 7, clock: 2, state: 'null' }]);
    expect(v.owned).toEqual([]);
  });

  it('an update to an owned id is not a new claim', () => {
    const v = filterAwareness(
      [entry(7, 2, presence('Ann')), entry(8, 1, presence('Ann'))],
      ctx([7]),
    );
    expect(v.tooMany).toBe(false);
    expect(v.owned).toEqual([7, 8]);
    expect(v.accepted).toHaveLength(2);
  });

  it('reports a third id and accepts nothing from that frame', () => {
    const v = filterAwareness([entry(9, 1, presence('Ann'))], ctx([7, 8]));
    expect(v.tooMany).toBe(true);
    expect(v.accepted).toEqual([]);
    expect(v.owned).toEqual([7, 8]);
  });
});
