declare const process: { env: Record<string, string | undefined> };

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  allowedWhenFull,
  applyCommand,
  type Command,
  DEFAULT_STYLE,
  getRoots,
  LOCAL_ORIGIN,
  SESSION_ORIGIN,
} from '../src';

const RUNS = Number(process.env.RELAY_FC_RUNS ?? 150);
const SHAPES = ['s0', 's1', 's2', 's3', 's4'];
const ROWS = ['r0', 'r1', 'r2'];
const COLS = ['c0', 'c1'];
const EVENTS = ['e0', 'e1'];

/** A board with shapes, connectors, a sheet with formatted cells and a calendar with events. */
function fixture(): Y.Doc {
  const doc = new Y.Doc();
  const run = (c: Command, origin = LOCAL_ORIGIN) => applyCommand(doc, c, origin);
  for (const id of SHAPES) {
    run({
      type: 'CreateShape',
      shape: {
        id,
        type: 'sticky',
        x: 0,
        y: 0,
        w: 180,
        h: 140,
        style: DEFAULT_STYLE.sticky,
        text: `note ${id}`,
        createdBy: 'u',
        authorName: 'U',
        createdAt: 0,
      },
    });
  }
  run({
    type: 'Connect',
    connector: {
      id: 'k0',
      from: { shapeId: 's0', anchor: 'auto' },
      to: { shapeId: 's1', anchor: 'auto' },
      routing: 'elbow',
      head: 'arrow',
      createdBy: 'u',
    },
  });
  run({
    type: 'Connect',
    connector: {
      id: 'k1',
      from: { x: 0, y: 0 },
      to: { shapeId: 's2', anchor: 'auto' },
      routing: 'straight',
      head: 'none',
      createdBy: 'u',
    },
  });
  run(
    {
      type: 'CreatePage',
      page: { id: 'sheet', type: 'sheet', title: 'S', order: 'a1', createdBy: 'u', createdAt: 0 },
      sheet: {
        rows: ['a0', 'a1', 'a2'].map((order, i) => ({ id: ROWS[i] as string, order })),
        cols: ['a0', 'a1'].map((order, i) => ({ id: COLS[i] as string, order })),
      },
    },
    SESSION_ORIGIN,
  );
  run({
    type: 'SetCells',
    pageId: 'sheet',
    cells: ROWS.flatMap((row) =>
      COLS.map((col) => ({ row, col, src: `${row}${col}`, fmt: { bold: true as const } })),
    ),
  });
  run(
    {
      type: 'CreatePage',
      page: { id: 'cal', type: 'calendar', title: 'C', order: 'a2', createdBy: 'u', createdAt: 0 },
    },
    SESSION_ORIGIN,
  );
  for (const id of EVENTS) {
    run({
      type: 'CreateEvent',
      pageId: 'cal',
      id,
      fields: {
        title: `event ${id}`,
        color: '#E85A1B',
        when: { allDay: true, start: '2026-10-05', end: '2026-10-05' },
        createdBy: 'u',
        createdAt: 0,
      },
    });
  }
  return doc;
}

/** The Yjs updates a command produces. */
function updatesOf(doc: Y.Doc, command: Command): Uint8Array[] {
  const updates: Uint8Array[] = [];
  const onUpdate = (u: Uint8Array) => updates.push(u);
  doc.on('update', onUpdate);
  applyCommand(doc, command, LOCAL_ORIGIN);
  doc.off('update', onUpdate);
  return updates;
}

const some = <T>(items: readonly T[]) => fc.subarray([...items], { minLength: 1 });
const allowedArb: fc.Arbitrary<Command> = fc.oneof(
  some([...SHAPES, 'k0', 'k1']).map((ids): Command => ({ type: 'DeleteShapes', ids })),
  some(ROWS).map((ids): Command => ({ type: 'DeleteRows', pageId: 'sheet', ids })),
  some(COLS).map((ids): Command => ({ type: 'DeleteCols', pageId: 'sheet', ids })),
  fc.constantFrom(...EVENTS).map((id): Command => ({ type: 'DeleteEvent', pageId: 'cal', id })),
  some(ROWS.flatMap((row) => COLS.map((col) => ({ row, col, src: '' })))).map(
    (cells): Command => ({ type: 'SetCells', pageId: 'sheet', cells }),
  ),
);

describe('allowedWhenFull', () => {
  it('the fixture really holds what the commands delete', () => {
    const roots = getRoots(fixture());
    expect(roots.shapes.size).toBe(SHAPES.length);
    expect(roots.connectors.size).toBe(2);
    expect(roots.sheets.has('sheet')).toBe(true);
    const events = roots.calendars.get('cal')?.get('events') as Y.Map<unknown> | undefined;
    expect(events?.size).toBe(EVENTS.length);
  });

  it('allows the deleting commands and a SetCells that only clears', () => {
    expect(allowedWhenFull({ type: 'DeleteShapes', ids: ['s0'] })).toBe(true);
    expect(allowedWhenFull({ type: 'DeleteRows', pageId: 'p', ids: ['r'] })).toBe(true);
    expect(allowedWhenFull({ type: 'DeleteCols', pageId: 'p', ids: ['c'] })).toBe(true);
    expect(allowedWhenFull({ type: 'DeleteEvent', pageId: 'p', id: 'e' })).toBe(true);
    expect(
      allowedWhenFull({ type: 'SetCells', pageId: 'p', cells: [{ row: 'r', col: 'c', src: '' }] }),
    ).toBe(true);
  });

  it('refuses everything that writes, including DeletePage and a clear that keeps a format', () => {
    expect(allowedWhenFull({ type: 'DeletePage', id: 'p' })).toBe(false);
    expect(allowedWhenFull({ type: 'MoveShapes', moves: [] })).toBe(false);
    expect(allowedWhenFull({ type: 'EndVote' })).toBe(false);
    expect(
      allowedWhenFull({ type: 'SetCells', pageId: 'p', cells: [{ row: 'r', col: 'c', src: 'x' }] }),
    ).toBe(false);
    expect(
      allowedWhenFull({
        type: 'SetCells',
        pageId: 'p',
        cells: [{ row: 'r', col: 'c', src: '', fmt: { bold: true } }],
      }),
    ).toBe(false);
  });

  it('an allowed command deletes something and adds no struct (a full server accepts it)', () => {
    const doc = fixture();
    const updates = updatesOf(doc, { type: 'DeleteShapes', ids: ['s0'] });
    expect(updates.length).toBeGreaterThan(0);
    expect(getRoots(doc).shapes.has('s0')).toBe(false);
    for (const u of updates) expect(Y.decodeUpdate(u).structs).toHaveLength(0);
  });

  it('every allowed command produces updates with no structs, over random sequences', () => {
    fc.assert(
      fc.property(fc.array(allowedArb, { minLength: 1, maxLength: 8 }), (commands) => {
        const doc = fixture();
        for (const command of commands) {
          expect(allowedWhenFull(command)).toBe(true);
          for (const u of updatesOf(doc, command)) {
            expect(Y.decodeUpdate(u).structs).toHaveLength(0);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });
});
