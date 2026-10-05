import * as encoding from 'lib0/encoding';
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

  it('rejects a client id or clock that is not a uint32', { timeout: 2000 }, async () => {
    // Helper: build an awareness update with manually crafted varints
    const buildUpdate = (clientIdBytes: Uint8Array, clockBytes: Uint8Array): Uint8Array => {
      const stateStr = JSON.stringify(presence('Test'));
      // Manually construct: count (1 byte), clientId bytes, clock bytes, state varint + string
      const stateEncoder = encoding.createEncoder();
      encoding.writeVarString(stateEncoder, stateStr);
      const stateBytes = encoding.toUint8Array(stateEncoder);

      const countEncoder = encoding.createEncoder();
      encoding.writeVarUint(countEncoder, 1);
      const countBytes = encoding.toUint8Array(countEncoder);

      return new Uint8Array([...countBytes, ...clientIdBytes, ...clockBytes, ...stateBytes]);
    };

    // Craft varints that decode to Infinity, NaN, huge non-integers, or out-of-range
    // 147 bytes of 0x80 followed by 0x01 decodes to Infinity
    const infinityBytes = Uint8Array.from([...Array(147).fill(0x80), 0x01]);
    // 147 bytes of 0x80 followed by 0x00 decodes to NaN
    const nanBytes = Uint8Array.from([...Array(147).fill(0x80), 0x00]);
    // 146 bytes of 0x80 followed by 0x01 decodes to ~4.49e307 (huge non-integer)
    const hugeBytes = Uint8Array.from([...Array(146).fill(0x80), 0x01]);
    // 0x1_0000_0000 (4294967296) is just over uint32 max
    const outOfRangeEncoder = encoding.createEncoder();
    encoding.writeVarUint(outOfRangeEncoder, 0x1_0000_0000);
    const outOfRangeBytes = encoding.toUint8Array(outOfRangeEncoder);

    const validClockBytes = (() => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 5);
      return encoding.toUint8Array(enc);
    })();
    const validClientIdBytes = (() => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 123);
      return encoding.toUint8Array(enc);
    })();

    // Test: clientId = Infinity
    expect(
      readAwarenessMessage(wrapAwareness(buildUpdate(infinityBytes, validClockBytes))),
    ).toBeNull();

    // Test: clientId = NaN
    expect(readAwarenessMessage(wrapAwareness(buildUpdate(nanBytes, validClockBytes)))).toBeNull();

    // Test: clientId = huge non-integer
    expect(readAwarenessMessage(wrapAwareness(buildUpdate(hugeBytes, validClockBytes)))).toBeNull();

    // Test: clientId = out of range (0x1_0000_0000)
    expect(
      readAwarenessMessage(wrapAwareness(buildUpdate(outOfRangeBytes, validClockBytes))),
    ).toBeNull();

    // Test: clock = Infinity
    expect(
      readAwarenessMessage(wrapAwareness(buildUpdate(validClientIdBytes, infinityBytes))),
    ).toBeNull();

    // Test: clock = NaN
    expect(
      readAwarenessMessage(wrapAwareness(buildUpdate(validClientIdBytes, nanBytes))),
    ).toBeNull();

    // Test: clock = huge non-integer
    expect(
      readAwarenessMessage(wrapAwareness(buildUpdate(validClientIdBytes, hugeBytes))),
    ).toBeNull();

    // Test: clock = out of range
    expect(
      readAwarenessMessage(wrapAwareness(buildUpdate(validClientIdBytes, outOfRangeBytes))),
    ).toBeNull();
  });

  it('accepts the largest uint32 client id and clock', () => {
    const entries = [
      {
        clientId: 0xffffffff,
        clock: 0xffffffff,
        state: JSON.stringify(presence('Max')),
      },
    ];
    expect(readAwarenessMessage(wrapAwareness(encodeAwarenessUpdate(entries)))).toEqual(entries);
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

  it('accepts a removal only for an owned id, and the id stays owned', () => {
    expect(filterAwareness([entry(7, 2, null)], ctx()).accepted).toEqual([]);
    const v = filterAwareness([entry(7, 2, null)], ctx([7]));
    expect(v.accepted).toEqual([{ clientId: 7, clock: 2, state: 'null' }]);
    // The room releases it once the removal has really taken the state away.
    expect(v.owned).toEqual([7]);
  });

  it('ids claimed and removed inside one frame still count towards the cap', () => {
    const v = filterAwareness(
      [
        entry(1, 5, presence('a')),
        entry(1, 3, null),
        entry(2, 5, presence('b')),
        entry(2, 3, null),
        entry(3, 5, presence('c')),
      ],
      ctx(),
    );
    expect(v.tooMany).toBe(true);
    expect(v.accepted).toEqual([]);
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
