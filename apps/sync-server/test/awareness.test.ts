import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';
import { Awareness, encodeAwarenessUpdate as yEncode } from 'y-protocols/awareness';
import * as Y from 'yjs';
import {
  type AwarenessEntry,
  applyTaken,
  compactState,
  encodeAwarenessUpdate,
  filterAwareness,
  heldFrame,
  readAwarenessMessage,
  readMessageType,
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

  it('rejects a client id or clock that is not a uint32', { timeout: 2000 }, () => {
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

  describe('hostile input', () => {
    const json = JSON.stringify(presence('Ann'));
    const wrap = (write: (e: encoding.Encoder) => void): Uint8Array => {
      const e = encoding.createEncoder();
      write(e);
      return wrapAwareness(encoding.toUint8Array(e));
    };

    it('rejects a string whose length says more than the frame holds', () => {
      const frame = wrap((e) => {
        encoding.writeVarUint(e, 1); // one entry
        encoding.writeVarUint(e, 7); // client id
        encoding.writeVarUint(e, 1); // clock
        encoding.writeVarUint(e, json.length + 500); // a length that lies
        encoding.writeUint8Array(e, new TextEncoder().encode(json));
      });
      expect(readAwarenessMessage(frame)).toBeNull();
    });

    it('rejects an entry count that does not match the entries', () => {
      const entryBytes = (e: encoding.Encoder, id: number) => {
        encoding.writeVarUint(e, id);
        encoding.writeVarUint(e, 1);
        encoding.writeVarString(e, json);
      };
      // Two entries announced, one sent.
      expect(
        readAwarenessMessage(
          wrap((e) => {
            encoding.writeVarUint(e, 2);
            entryBytes(e, 1);
          }),
        ),
      ).toBeNull();
      // One entry announced, two sent: the bytes past the first are trailing bytes.
      expect(
        readAwarenessMessage(
          wrap((e) => {
            encoding.writeVarUint(e, 1);
            entryBytes(e, 1);
            entryBytes(e, 2);
          }),
        ),
      ).toBeNull();
    });

    it('keeps every entry of a repeated id, in order: the filter decides what they mean', () => {
      const entries = [
        entry(5, 1, presence('Ann')),
        entry(5, 2, presence('Bob')),
        entry(5, 3, null),
      ];
      expect(readAwarenessMessage(wrapAwareness(encodeAwarenessUpdate(entries)))).toEqual(entries);
    });

    it('reads a state that is not JSON as text, and the filter drops it', () => {
      const raw: AwarenessEntry[] = [{ clientId: 5, clock: 1, state: 'not json {' }];
      expect(readAwarenessMessage(wrapAwareness(encodeAwarenessUpdate(raw)))).toEqual(raw);
      expect(filterAwareness(raw, ctx([5])).accepted).toEqual([]);
    });
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

describe('compactState', () => {
  it('keeps a state that fits as it is', () => {
    const state = presence('Ann', { selection: ['a', 'b'] });
    expect(compactState(state, 3000)).toBe(JSON.stringify(state));
  });

  it('drops the selection of a state that does not fit, and nothing else', () => {
    const state = presence('Ann', {
      cursor: { x: 1, y: 2 },
      selection: Array.from({ length: 100 }, (_, i) => `${'s'.repeat(60)}${i}`),
    });
    expect(JSON.stringify(state).length).toBeGreaterThan(3000);
    const compact = compactState(state, 3000);
    expect(compact.length).toBeLessThanOrEqual(3000);
    expect(JSON.parse(compact)).toEqual({ ...state, selection: [] });
  });
});

describe('readMessageType', () => {
  it('reads the type as a varint, whatever its length', () => {
    expect(readMessageType(Uint8Array.of(0, 1))).toBe(0);
    expect(readMessageType(Uint8Array.of(1, 0))).toBe(1);
    // The same 1 in two bytes: the first byte alone reads 129.
    expect(readMessageType(Uint8Array.of(0x81, 0x00, 0))).toBe(1);
    expect(readMessageType(Uint8Array.of(3))).toBe(3);
  });

  it('has no type for an empty frame or a varint that never ends', () => {
    expect(readMessageType(new Uint8Array())).toBeNull();
    expect(readMessageType(Uint8Array.of(0x80))).toBeNull();
  });

  it('reads NaN, not null, for a varint too long to be a number: no type matches it', () => {
    // lib0 does not throw for 147 continuation bytes and an end: the value overflows to NaN.
    const type = readMessageType(Uint8Array.of(...Array(147).fill(0x80), 0x00));
    expect(type).toBeNaN();
    expect([0, 1].includes(type as number)).toBe(false);
  });
});

describe('applyTaken and heldFrame', () => {
  const room = () => {
    const awareness = new Awareness(new Y.Doc());
    awareness.setLocalState(null);
    return awareness;
  };
  const apply = (awareness: Awareness, entries: AwarenessEntry[]) =>
    applyTaken(awareness, encodeAwarenessUpdate(entries), 'test');

  it('reports the ids whose entry was applied, a removal included', () => {
    const awareness = room();
    expect(apply(awareness, [entry(7, 1, presence('Ann')), entry(8, 1, presence('Bob'))])).toEqual([
      7, 8,
    ]);
    expect(apply(awareness, [entry(7, 2, null)])).toEqual([7]);
    awareness.destroy();
  });

  it('reports nothing for an entry whose clock the awareness has passed', () => {
    const awareness = room();
    apply(awareness, [entry(7, 100, presence('seed'))]);
    apply(awareness, [entry(7, 101, null)]);
    expect(apply(awareness, [entry(7, 5, presence('ghost'))])).toEqual([]);
    expect(awareness.getStates().has(7)).toBe(false);
    awareness.destroy();
  });

  it('reports an id once, however many of its entries were applied', () => {
    const awareness = room();
    // Each entry of the frame is applied; relaying the held state once per entry would repeat it.
    expect(
      apply(awareness, [
        entry(7, 1, presence('Ann')),
        entry(7, 2, presence('Ann B')),
        entry(7, 3, presence('Ann C')),
      ]),
    ).toEqual([7]);
    awareness.destroy();
  });

  it('frames the states as the awareness holds them, with a null for a removed one', () => {
    const awareness = room();
    apply(awareness, [entry(7, 3, presence('Ann')), entry(8, 4, presence('Bob'))]);
    apply(awareness, [entry(8, 5, null)]);
    expect(readAwarenessMessage(heldFrame(awareness, [7, 8]))).toEqual([
      entry(7, 3, presence('Ann')),
      entry(8, 5, null),
    ]);
    awareness.destroy();
  });
});
