declare const process: { env: Record<string, string | undefined> };

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  addDays,
  applyCommand,
  type Command,
  createUndo,
  EVENT_COLORS,
  type EventFields,
  formatDate,
  getRoots,
  importUpdateSize,
  LOCAL_ORIGIN,
  MAX_EVENTS,
  MAX_EXCEPTIONS,
  readCalendar,
  SESSION_ORIGIN,
} from '../src';

const RUNS = Number(process.env.RELAY_FC_RUNS ?? 100);

const fields = (over: Partial<EventFields> = {}): EventFields => ({
  title: 'Standup',
  color: EVENT_COLORS[0] as string,
  when: { allDay: false, start: '2026-09-28T09:00', end: '2026-09-28T09:15', tz: 'Europe/Madrid' },
  createdBy: 'u1',
  createdAt: 1,
  ...over,
});

function setup() {
  const doc = new Y.Doc();
  applyCommand(
    doc,
    {
      type: 'CreatePage',
      page: {
        id: 'cal',
        type: 'calendar',
        title: 'Cal',
        order: 'a1',
        createdBy: 'u1',
        createdAt: 1,
      },
    },
    SESSION_ORIGIN,
  );
  const run = (c: Command) => applyCommand(doc, c, LOCAL_ORIGIN);
  const read = () => readCalendar(getRoots(doc).calendars.get('cal'))?.events ?? [];
  return { doc, run, read };
}

describe('calendar commands', () => {
  it('creates, updates and deletes an event', () => {
    const { run, read } = setup();
    run({
      type: 'CreateEvent',
      pageId: 'cal',
      id: 'e1',
      fields: fields({ rule: { freq: 'weekly', interval: 1 } }),
    });
    expect(read()[0]).toMatchObject({
      id: 'e1',
      title: 'Standup',
      rule: { freq: 'weekly', interval: 1 },
    });
    run({
      type: 'UpdateEvent',
      pageId: 'cal',
      id: 'e1',
      patch: { title: 'Daily', rule: null, notes: 'n' },
    });
    expect(read()[0]).toMatchObject({ title: 'Daily', notes: 'n' });
    expect(read()[0]?.rule).toBeUndefined();
    run({ type: 'DeleteEvent', pageId: 'cal', id: 'e1' });
    expect(read()).toHaveLength(0);
  });

  it('caps text on write and ignores missing calendars and events', () => {
    const { run, read } = setup();
    run({
      type: 'CreateEvent',
      pageId: 'cal',
      id: 'e1',
      fields: fields({ title: 'x'.repeat(300), notes: 'y'.repeat(3000) }),
    });
    expect(read()[0]?.title).toHaveLength(120);
    expect(read()[0]?.notes).toHaveLength(2000);
    run({ type: 'CreateEvent', pageId: 'nope', id: 'e2', fields: fields() });
    run({ type: 'UpdateEvent', pageId: 'cal', id: 'ghost', patch: { title: 'boo' } });
    run({
      type: 'SetOccurrence',
      pageId: 'cal',
      id: 'ghost',
      key: '2026-09-28',
      value: { cancelled: true },
    });
    expect(read().map((e) => e.id)).toEqual(['e1']);
  });

  it('writes and clears occurrence exceptions, and clears them all on request', () => {
    const { run, read } = setup();
    run({
      type: 'CreateEvent',
      pageId: 'cal',
      id: 'e1',
      fields: fields({ rule: { freq: 'daily', interval: 1 } }),
    });
    run({
      type: 'SetOccurrence',
      pageId: 'cal',
      id: 'e1',
      key: '2026-09-29',
      value: { cancelled: true },
    });
    run({
      type: 'SetOccurrence',
      pageId: 'cal',
      id: 'e1',
      key: '2026-09-30',
      value: { when: fields().when, title: 'Moved' },
    });
    expect(Object.keys(read()[0]?.exceptions ?? {})).toEqual(['2026-09-29', '2026-09-30']);
    run({ type: 'ClearOccurrence', pageId: 'cal', id: 'e1', key: '2026-09-29' });
    expect(Object.keys(read()[0]?.exceptions ?? {})).toEqual(['2026-09-30']);
    run({
      type: 'UpdateEvent',
      pageId: 'cal',
      id: 'e1',
      patch: { when: fields().when },
      clearExceptions: true,
    });
    expect(read()[0]?.exceptions).toEqual({});
  });

  it('refuses a new event at the page cap, and a new exception at the series cap', () => {
    const { doc, run, read } = setup();
    doc.transact(() => {
      for (let i = 0; i < MAX_EVENTS; i++)
        run({ type: 'CreateEvent', pageId: 'cal', id: `e${i}`, fields: fields() });
    });
    run({ type: 'CreateEvent', pageId: 'cal', id: 'extra', fields: fields() });
    expect(read().some((e) => e.id === 'extra')).toBe(false);
    doc.transact(() => {
      for (let i = 0; i < MAX_EXCEPTIONS + 5; i++) {
        const key = formatDate(addDays({ y: 2027, m: 1, d: 1 }, i));
        run({ type: 'SetOccurrence', pageId: 'cal', id: 'e0', key, value: { cancelled: true } });
      }
    });
    const m = getRoots(doc).calendars.get('cal')?.get('events') as Y.Map<Y.Map<unknown>>;
    const ex = m.get('e0')?.get('exceptions') as Y.Map<unknown> | undefined;
    expect(ex?.size).toBe(MAX_EXCEPTIONS);
  });

  it('imports events with exceptions in one step, stopping at the cap', () => {
    const { doc, run, read } = setup();
    const undo = createUndo(doc);
    run({
      type: 'ImportEvents',
      pageId: 'cal',
      events: [
        {
          id: 'a',
          fields: fields({ uid: 'x@y', rule: { freq: 'daily', interval: 1 } }),
          exceptions: { '2026-09-29': { cancelled: true } },
        },
        { id: 'b', fields: fields({ title: 'B' }), exceptions: {} },
      ],
    });
    expect(read().map((e) => [e.id, e.uid ?? null])).toEqual([
      ['a', 'x@y'],
      ['b', null],
    ]);
    expect(read()[0]?.exceptions).toEqual({ '2026-09-29': { cancelled: true } });
    undo.undo();
    expect(read()).toHaveLength(0);
  });

  it('stops an import at the page cap (499 events + 3 imported → 500)', () => {
    const { doc, run, read } = setup();
    doc.transact(() => {
      for (let i = 0; i < MAX_EVENTS - 1; i++)
        run({ type: 'CreateEvent', pageId: 'cal', id: `e${i}`, fields: fields() });
    });
    run({
      type: 'ImportEvents',
      pageId: 'cal',
      events: ['x', 'y', 'z'].map((id) => ({ id, fields: fields({ title: id }), exceptions: {} })),
    });
    expect(read()).toHaveLength(MAX_EVENTS);
    expect(read().filter((e) => ['x', 'y', 'z'].includes(e.id))).toHaveLength(1);
  });

  it('sets and removes RSVP answers; SESSION answers are not undoable', () => {
    const { doc, run, read } = setup();
    run({ type: 'CreateEvent', pageId: 'cal', id: 'e1', fields: fields() });
    const undo = createUndo(doc);
    applyCommand(
      doc,
      {
        type: 'SetRsvp',
        pageId: 'cal',
        id: 'e1',
        userId: 'u2',
        status: 'maybe',
        name: 'B'.repeat(80),
      },
      SESSION_ORIGIN,
    );
    expect(read()[0]?.rsvp).toEqual({ u2: { status: 'maybe', name: 'B'.repeat(40) } });
    expect(undo.canUndo()).toBe(false);
    applyCommand(
      doc,
      { type: 'SetRsvp', pageId: 'cal', id: 'e1', userId: 'u2', status: null, name: '' },
      SESSION_ORIGIN,
    );
    expect(read()[0]?.rsvp).toEqual({});
  });

  it('measures an import update', () => {
    const small = importUpdateSize([{ id: 'a', fields: fields(), exceptions: {} }]);
    const big = importUpdateSize(
      Array.from({ length: 50 }, (_, i) => ({
        id: `e${i}`,
        fields: fields({ notes: 'z'.repeat(1900) }),
        exceptions: {},
      })),
    );
    expect(small).toBeGreaterThan(0);
    expect(big).toBeGreaterThan(90_000);
  });
});

// Three replicas apply random calendar commands and deliver updates in random order; they converge.
type Step =
  | { kind: 'create'; r: number; e: number }
  | { kind: 'title'; r: number; e: number; t: string }
  | { kind: 'delete'; r: number; e: number }
  | { kind: 'cancel'; r: number; e: number; day: number }
  | { kind: 'uncancel'; r: number; e: number; day: number }
  | { kind: 'reset'; r: number; e: number; hour: number }
  | { kind: 'rsvp'; r: number; e: number; s: 'yes' | 'no' | null }
  | { kind: 'deliver'; from: number; to: number };

const N = 3;
const r = fc.integer({ min: 0, max: N - 1 });
const e = fc.integer({ min: 0, max: 3 });
const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constant('create' as const), r, e }),
  fc.record({ kind: fc.constant('title' as const), r, e, t: fc.string({ maxLength: 5 }) }),
  fc.record({ kind: fc.constant('delete' as const), r, e }),
  fc.record({ kind: fc.constant('cancel' as const), r, e, day: fc.integer({ min: 1, max: 5 }) }),
  fc.record({ kind: fc.constant('uncancel' as const), r, e, day: fc.integer({ min: 1, max: 5 }) }),
  fc.record({ kind: fc.constant('reset' as const), r, e, hour: fc.integer({ min: 8, max: 9 }) }),
  fc.record({
    kind: fc.constant('rsvp' as const),
    r,
    e,
    s: fc.constantFrom('yes' as const, 'no' as const, null),
  }),
  fc.record({ kind: fc.constant('deliver' as const), from: r, to: r }),
);

describe('calendar convergence', () => {
  it('three replicas converge under random calendar edits', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 40 }), (steps) => {
        const base = setup().doc;
        const docs = Array.from({ length: N }, () => {
          const d = new Y.Doc();
          Y.applyUpdate(d, Y.encodeStateAsUpdate(base));
          return d;
        });
        for (const s of steps) {
          if (s.kind === 'deliver') {
            const from = docs[s.from] as Y.Doc;
            const to = docs[s.to] as Y.Doc;
            Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));
            continue;
          }
          const doc = docs[s.r] as Y.Doc;
          const id = `e${s.e}`;
          const c: Command =
            s.kind === 'create'
              ? { type: 'CreateEvent', pageId: 'cal', id, fields: fields() }
              : s.kind === 'title'
                ? { type: 'UpdateEvent', pageId: 'cal', id, patch: { title: s.t } }
                : s.kind === 'delete'
                  ? { type: 'DeleteEvent', pageId: 'cal', id }
                  : s.kind === 'cancel'
                    ? {
                        type: 'SetOccurrence',
                        pageId: 'cal',
                        id,
                        key: `2026-10-0${s.day}`,
                        value: { cancelled: true },
                      }
                    : s.kind === 'uncancel'
                      ? { type: 'ClearOccurrence', pageId: 'cal', id, key: `2026-10-0${s.day}` }
                      : s.kind === 'reset'
                        ? {
                            type: 'UpdateEvent',
                            pageId: 'cal',
                            id,
                            patch: {
                              when: {
                                allDay: false,
                                start: `2026-09-28T0${s.hour}:00`,
                                end: `2026-09-28T0${s.hour}:30`,
                                tz: 'Europe/Madrid',
                              },
                            },
                            clearExceptions: true,
                          }
                        : {
                            type: 'SetRsvp',
                            pageId: 'cal',
                            id,
                            userId: `u${s.r}`,
                            status: s.s,
                            name: 'N',
                          };
          applyCommand(doc, c, s.kind === 'rsvp' ? SESSION_ORIGIN : LOCAL_ORIGIN);
        }
        for (const a of docs) for (const b of docs) Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
        const snaps = docs.map((d) =>
          JSON.stringify(readCalendar(getRoots(d).calendars.get('cal'))),
        );
        expect(new Set(snaps).size).toBe(1);
      }),
      { numRuns: RUNS },
    );
  });
});
